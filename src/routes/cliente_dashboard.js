export async function clienteDashboardRoutes(app) {
  // GET /v1/cliente/dashboard
  app.get('/v1/cliente/dashboard', {
    preHandler: app.requirePapel(['cliente_parceiro']),
  }, async (request) => {
    const { sub: user_id, tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    
    try {
      // 1. Busca cliente vinculado ao usuário (mesmo email)
      const userQ = await db.query(`SELECT email FROM users WHERE id = $1`, [user_id])
      const email = userQ.rows[0]?.email

      const clienteQ = await db.query(`SELECT id FROM clientes WHERE email = $1 AND status = 'ativo' LIMIT 1`, [email])
      const cliente_id = clienteQ.rows[0]?.id

      if (!cliente_id) {
        return {
          faturamento_mes: 0,
          crescimento_pct: 0,
          volume_vendas: 0,
          lucro_estimado: 0,
          live_ativa: null,
          mais_vendidos: [],
          ranking_dia: null
        }
      }

      // 2. Busca o contrato ativo para saber o % de comissão do cliente
      const contratoQ = await db.query(`
        SELECT comissao_pct 
        FROM contratos 
        WHERE cliente_id = $1 AND status = 'ativo' 
        LIMIT 1
      `, [cliente_id])
      const comissaoPct = Number(contratoQ.rows[0]?.comissao_pct || 0)

      // 3. Faturamento e Comissão do Mês (Apenas lives encerradas)
      const mesQ = await db.query(`
        SELECT 
          COALESCE(SUM(fat_gerado), 0) AS faturamento_mes,
          COALESCE(SUM(comissao_calculada), 0) AS lucro_estimado
        FROM lives 
        WHERE cliente_id = $1 
          AND status = 'encerrada'
          AND date_trunc('month', encerrado_em) = date_trunc('month', NOW())
      `, [cliente_id])
      
      const faturamentoMes = Number(mesQ.rows[0].faturamento_mes)
      const lucroEstimado = Number(mesQ.rows[0].lucro_estimado)

      // 4. Crescimento mês atual vs anterior (Baseado no faturamento)
      const crescQ = await db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN date_trunc('month', encerrado_em) = date_trunc('month', NOW())
                            THEN fat_gerado END), 0) AS mes_atual,
          COALESCE(SUM(CASE WHEN date_trunc('month', encerrado_em) = date_trunc('month', NOW() - interval '1 month')
                            THEN fat_gerado END), 0) AS mes_anterior
        FROM lives WHERE cliente_id = $1 AND status = 'encerrada'
      `, [cliente_id])
      
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
        WHERE l.cliente_id = $1 AND l.status = 'em_andamento'
        LIMIT 1
      `, [cliente_id])
      
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
        WHERE l.cliente_id = $1
          AND date_trunc('month', l.criado_em) = date_trunc('month', NOW())
        GROUP BY lp.produto_nome
        ORDER BY qty DESC
        LIMIT 5
      `, [cliente_id])
      
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
        WHERE date_trunc('day', iniciado_em) = date_trunc('day', NOW())
        GROUP BY cliente_id
      `)
      
      const minhaPosicao = rankQ.rows.find(r => r.cliente_id === cliente_id)
      let rankingDia = null
      
      if (minhaPosicao) {
        rankingDia = {
          posicao: Number(minhaPosicao.posicao),
          gmv_dia: Number(minhaPosicao.total),
          total_participantes: Number(minhaPosicao.total_participantes)
        }
      }

      return {
        faturamento_mes: faturamentoMes,
        crescimento_pct: crescimento,
        volume_vendas:   volumeVendas,
        lucro_estimado:  lucroEstimado,
        live_ativa:      liveAtiva,
        mais_vendidos:   maisVendidos,
        ranking_dia:     rankingDia
      }
      
    } catch (e) {
      console.error(e)
      throw e
    } finally {
      db.release()
    }
  })
}
