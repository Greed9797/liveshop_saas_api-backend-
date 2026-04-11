export async function clienteDashboardRoutes(app) {
  // GET /v1/cliente/dashboard
  app.get('/v1/cliente/dashboard', {
    preHandler: app.requirePapel(['cliente_parceiro']),
  }, async (request) => {
    const { sub: user_id, tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    
    try {
      // 1. Busca cliente vinculado ao usuário (mesmo email)
      const userQ = await db.query(`
        SELECT email
        FROM users
        WHERE id = $1 AND tenant_id = $2
      `, [user_id, tenant_id])
      const email = userQ.rows[0]?.email

      const clienteQ = await db.query(`
        SELECT id, nicho, nome
        FROM clientes
        WHERE tenant_id = $1
          AND email = $2
          AND status = 'ativo'
        LIMIT 1
      `, [tenant_id, email])
      const clienteAtual = clienteQ.rows[0]
      const cliente_id = clienteAtual?.id
      const clienteNicho = clienteAtual?.nicho ?? null

      if (!cliente_id) {
        return {
          faturamento_mes: 0,
          crescimento_pct: 0,
          volume_vendas: 0,
          lucro_estimado: 0,
          live_ativa: null,
          mais_vendidos: [],
          ranking_dia: null,
          proxima_reserva: null,
          benchmark_nicho: null,
          benchmark_geral: null,
        }
      }

      // 2. Busca o contrato ativo para saber o % de comissão do cliente
      const contratoQ = await db.query(`
        SELECT id, comissao_pct, ativado_em, assinado_em
        FROM contratos 
        WHERE tenant_id = $1
          AND cliente_id = $2
          AND status = 'ativo' 
        ORDER BY ativado_em DESC NULLS LAST, criado_em DESC
        LIMIT 1
      `, [tenant_id, cliente_id])
      const comissaoPct = Number(contratoQ.rows[0]?.comissao_pct || 0)

      // 3. Faturamento e Comissão do Mês (Apenas lives encerradas)
      const mesQ = await db.query(`
        SELECT 
          COALESCE(SUM(fat_gerado), 0) AS faturamento_mes,
          COALESCE(SUM(comissao_calculada), 0) AS lucro_estimado
        FROM lives 
        WHERE tenant_id = $1
          AND cliente_id = $2 
          AND status = 'encerrada'
          AND date_trunc('month', encerrado_em) = date_trunc('month', NOW())
      `, [tenant_id, cliente_id])
      
      const faturamentoMes = Number(mesQ.rows[0].faturamento_mes)
      const lucroEstimado = Number(mesQ.rows[0].lucro_estimado)

      // 4. Crescimento mês atual vs anterior (Baseado no faturamento)
      const crescQ = await db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN date_trunc('month', encerrado_em) = date_trunc('month', NOW())
                            THEN fat_gerado END), 0) AS mes_atual,
          COALESCE(SUM(CASE WHEN date_trunc('month', encerrado_em) = date_trunc('month', NOW() - interval '1 month')
                            THEN fat_gerado END), 0) AS mes_anterior
        FROM lives
        WHERE tenant_id = $1
          AND cliente_id = $2
          AND status = 'encerrada'
      `, [tenant_id, cliente_id])
      
      const c = crescQ.rows[0]
      const crescimento = Number(c.mes_anterior) > 0
        ? Math.round(((Number(c.mes_atual) - Number(c.mes_anterior)) / Number(c.mes_anterior)) * 100)
        : 0

      // 5. Verifica se há uma Live Ativa agora e pega os dados do TikTok (Snapshots)
      const liveQ = await db.query(`
        SELECT 
          l.id, l.iniciado_em,
          c.numero AS cabine_numero,
          COALESCE(ls.viewer_count, 0) AS viewer_count,
          COALESCE(ls.gmv, 0) AS gmv_atual
        FROM lives l 
        JOIN cabines c ON c.id = l.cabine_id
        LEFT JOIN LATERAL (
          SELECT viewer_count, gmv 
          FROM live_snapshots 
          WHERE live_id = l.id 
          ORDER BY captured_at DESC LIMIT 1
        ) ls ON true
        WHERE l.tenant_id = $1
          AND l.cliente_id = $2
          AND l.status = 'em_andamento'
        LIMIT 1
      `, [tenant_id, cliente_id])
      
      const liveRow = liveQ.rows[0]
      let liveAtiva = null

      if (liveRow) {
        const iniciadoEm = new Date(liveRow.iniciado_em)
        const duracaoMin = Math.floor((new Date() - iniciadoEm) / 1000 / 60)
        const gmvAtual = Number(liveRow.gmv_atual)
        
        liveAtiva = {
          cabine_numero: liveRow.cabine_numero,
          viewer_count: Number(liveRow.viewer_count),
          gmv_atual: gmvAtual,
          comissao_projetada: gmvAtual * (comissaoPct / 100),
          duracao_min: duracaoMin,
          iniciou_em: iniciadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        }
      }

      // 6. Produtos Mais Vendidos do Mês (Agrupado por nome)
      const produtosQ = await db.query(`
        SELECT 
          lp.produto_nome AS produto, 
          SUM(lp.quantidade) AS qty, 
          SUM(lp.valor_total) AS valor
        FROM live_products lp
        JOIN lives l ON l.id = lp.live_id
        WHERE l.tenant_id = $1
          AND l.cliente_id = $2
          AND date_trunc('month', l.iniciado_em) = date_trunc('month', NOW())
        GROUP BY lp.produto_nome
        ORDER BY qty DESC
        LIMIT 5
      `, [tenant_id, cliente_id])
      
      const maisVendidos = produtosQ.rows.map(p => ({
        produto: p.produto,
        qty: Number(p.qty),
        valor: Number(p.valor)
      }))

      // Calcula volume total de vendas de itens do mês
      const volumeVendas = maisVendidos.reduce((acc, curr) => acc + curr.qty, 0)

      // 7. Ranking do Dia
      const rankQ = await db.query(`
        SELECT cliente_id, SUM(fat_gerado) AS total,
               RANK() OVER (ORDER BY SUM(fat_gerado) DESC) AS posicao,
               COUNT(*) OVER() as total_participantes
        FROM lives
        WHERE tenant_id = $1
          AND date_trunc('day', iniciado_em) = date_trunc('day', NOW())
        GROUP BY cliente_id
      `, [tenant_id])
      
      const minhaPosicao = rankQ.rows.find(r => r.cliente_id === cliente_id)
      let rankingDia = null
      
      if (minhaPosicao) {
        rankingDia = {
          posicao: Number(minhaPosicao.posicao),
          gmv_dia: Number(minhaPosicao.total),
          total_participantes: Number(minhaPosicao.total_participantes)
        }
      }

      // 8. Próxima reserva operacional (cabine já vinculada para próxima operação)
      const proximaReservaQ = await db.query(`
        SELECT
          c.id AS cabine_id,
          c.numero AS cabine_numero,
          c.status,
          c.contrato_id,
          ct.ativado_em,
          ct.assinado_em
        FROM cabines c
        JOIN contratos ct ON ct.id = c.contrato_id
        WHERE ct.tenant_id = $1
          AND ct.cliente_id = $2
          AND c.status IN ('reservada', 'ativa')
        ORDER BY CASE c.status WHEN 'reservada' THEN 0 ELSE 1 END, c.numero ASC
        LIMIT 1
      `, [tenant_id, cliente_id])

      const proximaReserva = proximaReservaQ.rows[0]
        ? {
            cabine_id: proximaReservaQ.rows[0].cabine_id,
            cabine_numero: Number(proximaReservaQ.rows[0].cabine_numero),
            status: proximaReservaQ.rows[0].status,
            contrato_id: proximaReservaQ.rows[0].contrato_id,
            ativado_em: proximaReservaQ.rows[0].ativado_em,
            assinado_em: proximaReservaQ.rows[0].assinado_em,
          }
        : null

      // 9. Benchmark anônimo do ecossistema (últimos 90 dias)
      const benchmarkQ = await db.query(`
        WITH base_90_dias AS (
          SELECT
            l.cliente_id,
            c.nicho,
            COALESCE(SUM(l.fat_gerado), 0) AS gmv_total,
            COUNT(l.id) AS total_lives
          FROM lives l
          JOIN clientes c ON c.id = l.cliente_id
          WHERE l.tenant_id = $1
            AND l.status = 'encerrada'
            AND l.iniciado_em >= CURRENT_DATE - INTERVAL '90 days'
            AND c.status = 'ativo'
          GROUP BY l.cliente_id, c.nicho
        ), cliente_base AS (
          SELECT
            $2::uuid AS cliente_id,
            $3::text AS nicho,
            COALESCE((SELECT gmv_total FROM base_90_dias WHERE cliente_id = $2), 0)::numeric AS meu_gmv
        ), rank_base AS (
          SELECT cliente_id, nicho, gmv_total
          FROM base_90_dias
          UNION ALL
          SELECT cb.cliente_id, cb.nicho, cb.meu_gmv
          FROM cliente_base cb
          WHERE NOT EXISTS (
            SELECT 1 FROM base_90_dias b WHERE b.cliente_id = cb.cliente_id
          )
        ), ranked AS (
          SELECT
            rb.cliente_id,
            rb.nicho,
            rb.gmv_total,
            PERCENT_RANK() OVER (PARTITION BY rb.nicho ORDER BY rb.gmv_total) AS percentil_nicho,
            PERCENT_RANK() OVER (ORDER BY rb.gmv_total) AS percentil_geral
          FROM rank_base rb
        ), avg_nicho AS (
          SELECT AVG(gmv_total) AS media_gmv, COUNT(*) AS amostra
          FROM base_90_dias
          WHERE nicho IS NOT DISTINCT FROM $3
        ), avg_geral AS (
          SELECT AVG(gmv_total) AS media_gmv, COUNT(*) AS amostra
          FROM base_90_dias
        ), meu_rank AS (
          SELECT percentil_nicho, percentil_geral
          FROM ranked
          WHERE cliente_id = $2
          LIMIT 1
        )
        SELECT
          cb.nicho,
          cb.meu_gmv,
          an.media_gmv AS media_gmv_nicho,
          an.amostra AS amostra_nicho,
          ag.media_gmv AS media_gmv_geral,
          ag.amostra AS amostra_geral,
          mr.percentil_nicho,
          mr.percentil_geral
        FROM cliente_base cb
        CROSS JOIN avg_nicho an
        CROSS JOIN avg_geral ag
        LEFT JOIN meu_rank mr ON true
      `, [tenant_id, cliente_id, clienteNicho])

      const benchmark = benchmarkQ.rows[0] ?? {}

      const buildBenchmark = ({
        niche,
        meuGmv,
        mediaGmv,
        amostra,
        percentil,
        minimumSample,
      }) => {
        const media = Number(mediaGmv ?? 0)
        const sampleSize = Number(amostra ?? 0)

        if (sampleSize < minimumSample) {
          return null
        }

        const meu = Number(meuGmv ?? 0)
        const percentualDaMedia = media > 0
          ? Number(((meu / media) * 100).toFixed(1))
          : 0

        return {
          nicho: niche,
          meu_gmv: meu,
          media_gmv: Number(media.toFixed(2)),
          percentual_da_media: percentualDaMedia,
          percentil: percentil == null ? null : Number(Number(percentil).toFixed(2)),
          amostra: sampleSize,
          acima_da_media: meu > media,
        }
      }

      const benchmarkNicho = clienteNicho == null
        ? null
        : buildBenchmark({
            niche: clienteNicho,
            meuGmv: benchmark.meu_gmv,
            mediaGmv: benchmark.media_gmv_nicho,
            amostra: benchmark.amostra_nicho,
            percentil: benchmark.percentil_nicho,
            minimumSample: 5,
          })

      const benchmarkGeral = buildBenchmark({
        niche: null,
        meuGmv: benchmark.meu_gmv,
        mediaGmv: benchmark.media_gmv_geral,
        amostra: benchmark.amostra_geral,
        percentil: benchmark.percentil_geral,
        minimumSample: 10,
      })

      return {
        faturamento_mes: faturamentoMes,
        crescimento_pct: crescimento,
        volume_vendas:   volumeVendas,
        lucro_estimado:  lucroEstimado,
        live_ativa:      liveAtiva,
        mais_vendidos:   maisVendidos,
        ranking_dia:     rankingDia,
        proxima_reserva: proximaReserva,
        benchmark_nicho: benchmarkNicho,
        benchmark_geral: benchmarkGeral,
      }

    } catch (e) {
      console.error(e)
      throw e
    } finally {
      db.release()
    }
  })

  // GET /v1/cliente/vendas — histórico de lives do cliente por mês
  app.get('/v1/cliente/vendas', {
    preHandler: app.requirePapel(['cliente_parceiro']),
  }, async (request) => {
    const { sub: user_id, tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)

    try {
      const userQ = await db.query(
        `SELECT email FROM users WHERE id = $1 AND tenant_id = $2`,
        [user_id, tenant_id]
      )
      const email = userQ.rows[0]?.email

      const clienteQ = await db.query(
        `SELECT id FROM clientes WHERE tenant_id = $1 AND email = $2 AND status = 'ativo' LIMIT 1`,
        [tenant_id, email]
      )
      const cliente_id = clienteQ.rows[0]?.id
      if (!cliente_id) return { resumo: { total_faturamento: 0, total_vendas: 0, total_lives: 0 }, lives: [] }

      const mes = Number(request.query.mes) || (new Date().getMonth() + 1)
      const ano = Number(request.query.ano) || new Date().getFullYear()

      const livesQ = await db.query(`
        SELECT
          l.id, l.iniciado_em, l.encerrado_em,
          c.numero AS cabine_numero,
          u.nome AS apresentador_nome,
          l.status,
          COALESCE(l.fat_gerado, 0) AS total_faturamento,
          COALESCE(l.comissao_calculada, 0) AS comissao,
          COALESCE(
            (SELECT SUM(lp.quantidade) FROM live_products lp WHERE lp.live_id = l.id), 0
          ) AS total_vendas,
          EXTRACT(EPOCH FROM (COALESCE(l.encerrado_em, NOW()) - l.iniciado_em)) / 60 AS duracao_min
        FROM lives l
        LEFT JOIN cabines c ON c.id = l.cabine_id
        LEFT JOIN users u ON u.id = l.apresentador_id
        WHERE l.tenant_id = $1
          AND l.cliente_id = $2
          AND EXTRACT(MONTH FROM l.iniciado_em) = $3
          AND EXTRACT(YEAR FROM l.iniciado_em) = $4
          AND l.status IN ('encerrada', 'em_andamento')
        ORDER BY l.iniciado_em DESC
      `, [tenant_id, cliente_id, mes, ano])

      const lives = livesQ.rows.map(r => ({
        id: r.id,
        iniciado_em: r.iniciado_em,
        encerrado_em: r.encerrado_em,
        cabine_numero: Number(r.cabine_numero),
        streamer_nome: r.apresentador_nome,
        status: r.status,
        total_faturamento: Number(r.total_faturamento),
        comissao: Number(r.comissao),
        total_vendas: Number(r.total_vendas),
        duracao_min: Math.round(Number(r.duracao_min)),
      }))

      return {
        resumo: {
          total_faturamento: lives.reduce((s, l) => s + l.total_faturamento, 0),
          total_vendas: lives.reduce((s, l) => s + l.total_vendas, 0),
          total_lives: lives.length,
        },
        lives,
      }
    } finally {
      db.release()
    }
  })

  // GET /v1/cliente/produtos — produtos agregados por mês
  app.get('/v1/cliente/produtos', {
    preHandler: app.requirePapel(['cliente_parceiro']),
  }, async (request) => {
    const { sub: user_id, tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)

    try {
      const userQ = await db.query(
        `SELECT email FROM users WHERE id = $1 AND tenant_id = $2`,
        [user_id, tenant_id]
      )
      const email = userQ.rows[0]?.email

      const clienteQ = await db.query(
        `SELECT id FROM clientes WHERE tenant_id = $1 AND email = $2 AND status = 'ativo' LIMIT 1`,
        [tenant_id, email]
      )
      const cliente_id = clienteQ.rows[0]?.id
      if (!cliente_id) return { resumo: { total_produtos: 0, total_qty: 0, total_faturamento: 0 }, produtos: [] }

      const mes = Number(request.query.mes) || (new Date().getMonth() + 1)
      const ano = Number(request.query.ano) || new Date().getFullYear()

      const prodQ = await db.query(`
        SELECT
          lp.produto_nome,
          SUM(lp.quantidade) AS total_qty,
          SUM(lp.valor_total) AS total_faturamento
        FROM live_products lp
        JOIN lives l ON l.id = lp.live_id
        WHERE l.tenant_id = $1
          AND l.cliente_id = $2
          AND EXTRACT(MONTH FROM l.iniciado_em) = $3
          AND EXTRACT(YEAR FROM l.iniciado_em) = $4
          AND l.status IN ('encerrada', 'em_andamento')
        GROUP BY lp.produto_nome
        ORDER BY total_faturamento DESC
      `, [tenant_id, cliente_id, mes, ano])

      const produtos = prodQ.rows.map(p => ({
        produto_nome: p.produto_nome,
        total_qty: Number(p.total_qty),
        total_faturamento: Number(p.total_faturamento),
      }))

      return {
        resumo: {
          total_produtos: produtos.length,
          total_qty: produtos.reduce((s, p) => s + p.total_qty, 0),
          total_faturamento: produtos.reduce((s, p) => s + p.total_faturamento, 0),
        },
        produtos,
      }
    } finally {
      db.release()
    }
  })

  // ──────────────────────────────────────────────────────────────
  // MINHAS CABINES
  // ──────────────────────────────────────────────────────────────

  // GET /v1/cliente/cabines — lista cabines vinculadas ao cliente via contratos ativos
  app.get('/v1/cliente/cabines', {
    preHandler: app.requirePapel(['cliente_parceiro']),
  }, async (request) => {
    const { sub: user_id, tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)

    try {
      const userQ = await db.query(
        `SELECT email FROM users WHERE id = $1 AND tenant_id = $2`,
        [user_id, tenant_id]
      )
      const email = userQ.rows[0]?.email

      const clienteQ = await db.query(
        `SELECT id FROM clientes WHERE tenant_id = $1 AND email = $2 AND status = 'ativo' LIMIT 1`,
        [tenant_id, email]
      )
      const cliente_id = clienteQ.rows[0]?.id
      if (!cliente_id) return []

      const cabinesQ = await db.query(`
        SELECT
          cab.id,
          cab.numero,
          cab.status,
          cab.live_atual_id,
          cab.contrato_id,
          $2::uuid          AS cliente_id,
          cli.nome          AS cliente_nome,
          u.nome            AS apresentador_nome,
          COALESCE(snap.viewer_count, 0) AS viewer_count,
          COALESCE(snap.gmv, 0)          AS gmv_atual,
          l.iniciado_em
        FROM contratos ct
        JOIN cabines cab ON cab.contrato_id = ct.id
        LEFT JOIN lives l ON l.id = cab.live_atual_id AND l.status = 'em_andamento'
        LEFT JOIN LATERAL (
          SELECT viewer_count, gmv
          FROM live_snapshots
          WHERE live_id = l.id
          ORDER BY captured_at DESC
          LIMIT 1
        ) snap ON true
        LEFT JOIN users u ON u.id = l.apresentador_id
        JOIN clientes cli ON cli.id = ct.cliente_id
        WHERE ct.tenant_id = $1
          AND ct.cliente_id = $2
          AND ct.status = 'ativo'
        ORDER BY cab.numero
      `, [tenant_id, cliente_id])

      return cabinesQ.rows.map(r => ({
        id:               r.id,
        numero:           Number(r.numero),
        status:           r.status,
        live_atual_id:    r.live_atual_id,
        contrato_id:      r.contrato_id,
        cliente_id:       r.cliente_id,
        cliente_nome:     r.cliente_nome,
        apresentador_nome: r.apresentador_nome,
        viewer_count:     Number(r.viewer_count),
        gmv_atual:        Number(r.gmv_atual),
        iniciado_em:      r.iniciado_em,
      }))
    } finally {
      db.release()
    }
  })

  // GET /v1/cliente/cabines/:cabineId — detalhe da cabine + live atual + histórico
  app.get('/v1/cliente/cabines/:cabineId', {
    preHandler: app.requirePapel(['cliente_parceiro']),
  }, async (request, reply) => {
    const { sub: user_id, tenant_id } = request.user
    const { cabineId } = request.params
    const db = await app.dbTenant(tenant_id)

    try {
      const userQ = await db.query(
        `SELECT email FROM users WHERE id = $1 AND tenant_id = $2`,
        [user_id, tenant_id]
      )
      const email = userQ.rows[0]?.email

      const clienteQ = await db.query(
        `SELECT id FROM clientes WHERE tenant_id = $1 AND email = $2 AND status = 'ativo' LIMIT 1`,
        [tenant_id, email]
      )
      const cliente_id = clienteQ.rows[0]?.id
      if (!cliente_id) return reply.code(403).send({ error: 'Cliente não encontrado' })

      // Valida que a cabine pertence ao cliente via contrato ativo
      const cabineQ = await db.query(`
        SELECT cab.id, cab.numero, cab.status, cab.live_atual_id
        FROM cabines cab
        JOIN contratos ct ON ct.id = cab.contrato_id
        WHERE cab.id = $1
          AND ct.tenant_id = $2
          AND ct.cliente_id = $3
          AND ct.status = 'ativo'
        LIMIT 1
      `, [cabineId, tenant_id, cliente_id])

      if (!cabineQ.rows[0]) {
        return reply.code(404).send({ error: 'Cabine não encontrada ou não pertence a este cliente' })
      }
      const cabine = cabineQ.rows[0]

      // Live atual (se houver)
      let liveAtual = null
      if (cabine.live_atual_id) {
        const liveQ = await db.query(`
          SELECT
            l.id AS live_id,
            l.iniciado_em,
            u.nome AS apresentador_nome,
            COALESCE(snap.viewer_count, 0)    AS viewer_count,
            COALESCE(snap.gmv, 0)             AS gmv_atual,
            COALESCE(snap.total_orders, 0)    AS total_orders,
            COALESCE(snap.likes_count, 0)     AS likes_count,
            COALESCE(snap.comments_count, 0)  AS comments_count,
            EXTRACT(EPOCH FROM (NOW() - l.iniciado_em)) / 60 AS duracao_minutos,
            (
              SELECT lp.produto_nome
              FROM live_products lp
              WHERE lp.live_id = l.id
              GROUP BY lp.produto_nome
              ORDER BY SUM(lp.quantidade) DESC
              LIMIT 1
            ) AS top_produto
          FROM lives l
          LEFT JOIN LATERAL (
            SELECT viewer_count, gmv, total_orders, likes_count, comments_count
            FROM live_snapshots
            WHERE live_id = l.id
            ORDER BY captured_at DESC
            LIMIT 1
          ) snap ON true
          LEFT JOIN users u ON u.id = l.apresentador_id
          WHERE l.id = $1 AND l.status = 'em_andamento'
        `, [cabine.live_atual_id])

        if (liveQ.rows[0]) {
          const lr = liveQ.rows[0]
          liveAtual = {
            live_id:          lr.live_id,
            viewer_count:     Number(lr.viewer_count),
            gmv_atual:        Number(lr.gmv_atual),
            total_orders:     Number(lr.total_orders),
            duracao_minutos:  Math.round(Number(lr.duracao_minutos)),
            apresentador_nome: lr.apresentador_nome,
            iniciado_em:      lr.iniciado_em,
            likes_count:      Number(lr.likes_count),
            comments_count:   Number(lr.comments_count),
            top_produto:      lr.top_produto,
          }
        }
      }

      // Histórico das últimas 20 lives desta cabine para este cliente
      const historicoQ = await db.query(`
        SELECT
          l.id,
          l.iniciado_em,
          l.encerrado_em,
          l.status,
          COALESCE(l.fat_gerado, 0)        AS fat_gerado,
          COALESCE(l.comissao_calculada, 0) AS comissao_calculada,
          ROUND(
            EXTRACT(EPOCH FROM (COALESCE(l.encerrado_em, l.iniciado_em) - l.iniciado_em)) / 60
          ) AS duracao_min
        FROM lives l
        WHERE l.tenant_id = $1
          AND l.cabine_id = $2
          AND l.cliente_id = $3
          AND l.status IN ('encerrada', 'em_andamento')
        ORDER BY l.iniciado_em DESC
        LIMIT 20
      `, [tenant_id, cabineId, cliente_id])

      return {
        cabine: {
          id:     cabine.id,
          numero: Number(cabine.numero),
          status: cabine.status,
        },
        live_atual: liveAtual,
        historico_lives: historicoQ.rows.map(r => ({
          id:                 r.id,
          iniciado_em:        r.iniciado_em,
          encerrado_em:       r.encerrado_em,
          status:             r.status,
          fat_gerado:         Number(r.fat_gerado),
          comissao_calculada: Number(r.comissao_calculada),
          duracao_min:        Number(r.duracao_min),
        })),
      }
    } finally {
      db.release()
    }
  })

  // GET /v1/cliente/cabines/:cabineId/solicitacoes — minhas solicitações desta cabine
  app.get('/v1/cliente/cabines/:cabineId/solicitacoes', {
    preHandler: app.requirePapel(['cliente_parceiro']),
  }, async (request, reply) => {
    const { sub: user_id, tenant_id } = request.user
    const { cabineId } = request.params
    const db = await app.dbTenant(tenant_id)

    try {
      const userQ = await db.query(
        `SELECT email FROM users WHERE id = $1 AND tenant_id = $2`,
        [user_id, tenant_id]
      )
      const email = userQ.rows[0]?.email

      const clienteQ = await db.query(
        `SELECT id FROM clientes WHERE tenant_id = $1 AND email = $2 AND status = 'ativo' LIMIT 1`,
        [tenant_id, email]
      )
      const cliente_id = clienteQ.rows[0]?.id
      if (!cliente_id) return reply.code(403).send({ error: 'Cliente não encontrado' })

      const q = await db.query(`
        SELECT id, data_solicitada, hora_inicio, hora_fim, observacao, status,
               motivo_recusa, criado_em
        FROM live_requests
        WHERE tenant_id = $1
          AND cabine_id = $2
          AND cliente_id = $3
        ORDER BY criado_em DESC
        LIMIT 50
      `, [tenant_id, cabineId, cliente_id])

      return q.rows.map(r => ({
        id:              r.id,
        data_solicitada: r.data_solicitada, // DATE → "YYYY-MM-DD"
        hora_inicio:     r.hora_inicio,     // TIME → "HH:MM:SS"
        hora_fim:        r.hora_fim,
        observacao:      r.observacao,
        status:          r.status,
        motivo_recusa:   r.motivo_recusa,
        criado_em:       r.criado_em,
      }))
    } finally {
      db.release()
    }
  })

  // POST /v1/cliente/cabines/:cabineId/solicitar-live — criar solicitação de live
  app.post('/v1/cliente/cabines/:cabineId/solicitar-live', {
    preHandler: app.requirePapel(['cliente_parceiro']),
  }, async (request, reply) => {
    const { sub: user_id, tenant_id } = request.user
    const { cabineId } = request.params
    const { data_solicitada, hora_inicio, hora_fim, observacao } = request.body ?? {}

    // Validações básicas (sem converter para Date — tudo string)
    if (!data_solicitada || !hora_inicio || !hora_fim) {
      return reply.code(400).send({ error: 'data_solicitada, hora_inicio e hora_fim são obrigatórios' })
    }
    // Formato esperado: "YYYY-MM-DD" e "HH:MM"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data_solicitada)) {
      return reply.code(400).send({ error: 'data_solicitada deve estar no formato YYYY-MM-DD' })
    }
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(hora_inicio) || !/^\d{2}:\d{2}(:\d{2})?$/.test(hora_fim)) {
      return reply.code(400).send({ error: 'hora_inicio e hora_fim devem estar no formato HH:MM' })
    }
    if (hora_fim <= hora_inicio) {
      return reply.code(400).send({ error: 'hora_fim deve ser maior que hora_inicio' })
    }

    const db = await app.dbTenant(tenant_id)
    try {
      const userQ = await db.query(
        `SELECT email FROM users WHERE id = $1 AND tenant_id = $2`,
        [user_id, tenant_id]
      )
      const email = userQ.rows[0]?.email

      const clienteQ = await db.query(
        `SELECT id FROM clientes WHERE tenant_id = $1 AND email = $2 AND status = 'ativo' LIMIT 1`,
        [tenant_id, email]
      )
      const cliente_id = clienteQ.rows[0]?.id
      if (!cliente_id) return reply.code(403).send({ error: 'Cliente não encontrado' })

      // Valida que a cabine pertence ao cliente via contrato ativo
      const cabineQ = await db.query(`
        SELECT cab.id FROM cabines cab
        JOIN contratos ct ON ct.id = cab.contrato_id
        WHERE cab.id = $1
          AND ct.tenant_id = $2
          AND ct.cliente_id = $3
          AND ct.status = 'ativo'
        LIMIT 1
      `, [cabineId, tenant_id, cliente_id])

      if (!cabineQ.rows[0]) {
        return reply.code(404).send({ error: 'Cabine não encontrada ou não pertence a este cliente' })
      }

      // Valida que a data não é no passado (comparação pura de string ISO date)
      const hoje = new Date().toISOString().slice(0, 10) // "YYYY-MM-DD" UTC
      if (data_solicitada < hoje) {
        return reply.code(400).send({ error: 'data_solicitada não pode ser no passado' })
      }

      const inserted = await db.query(`
        INSERT INTO live_requests
          (tenant_id, cabine_id, cliente_id, solicitante_id,
           data_solicitada, hora_inicio, hora_fim, observacao)
        VALUES ($1, $2, $3, $4, $5::date, $6::time, $7::time, $8)
        RETURNING id, data_solicitada, hora_inicio, hora_fim, observacao, status, criado_em
      `, [tenant_id, cabineId, cliente_id, user_id,
          data_solicitada, hora_inicio, hora_fim, observacao ?? null])

      const r = inserted.rows[0]
      return reply.code(201).send({
        id:              r.id,
        data_solicitada: r.data_solicitada,
        hora_inicio:     r.hora_inicio,
        hora_fim:        r.hora_fim,
        observacao:      r.observacao,
        status:          r.status,
        criado_em:       r.criado_em,
      })
    } finally {
      db.release()
    }
  })
}
