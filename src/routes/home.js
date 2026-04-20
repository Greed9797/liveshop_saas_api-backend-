export async function homeRoutes(app) {
  // GET /v1/home/dashboard
  app.get('/v1/home/dashboard', {
    preHandler: app.requirePapel(['franqueado', 'franqueador_master', 'gerente']),
  }, async (request) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)

    try {
      // 1. Financeiro: Faturamento Fixo dos contratos ativos
      const fixoQ = await db.query(`SELECT COALESCE(SUM(valor_fixo), 0) AS valor FROM contratos WHERE status = 'ativo'`)
      
      // Financeiro: Comissão das Lives do mês (GMV * % da comissão)
      const varQ = await db.query(`
        SELECT COALESCE(SUM(l.fat_gerado * (COALESCE(c.comissao_pct, 0) / 100.0)), 0) AS valor
        FROM lives l
        JOIN contratos c ON c.cliente_id = l.cliente_id AND c.status = 'ativo'
        WHERE date_trunc('month', l.iniciado_em) = date_trunc('month', NOW())
      `)

      // Financeiro: Custos do mês
      const custosQ = await db.query(`
        SELECT COALESCE(SUM(valor), 0) AS valor
        FROM custos
        WHERE date_trunc('month', competencia) = date_trunc('month', NOW())
      `)

      const fatFixo = Number(fixoQ.rows[0].valor)
      const fatComissao = Number(varQ.rows[0].valor)
      const totalCustos = Number(custosQ.rows[0].valor)

      const fatBruto = fatFixo + fatComissao
      const fatLiquido = fatBruto - totalCustos

      // 2. Cabines (Status real-time do TikTok usando snapshots via LATERAL JOIN)
      const cabinesQ = await db.query(`
        SELECT 
            c.numero, c.status, c.live_atual_id,
            l.iniciado_em,
            cl.nome AS cliente_nome,
            u.nome AS apresentador,
            COALESCE(ls.viewer_count, 0) AS viewer_count,
            COALESCE(ls.gmv, 0) AS gmv_atual
        FROM cabines c
        LEFT JOIN lives l ON l.id = c.live_atual_id
        LEFT JOIN clientes cl ON cl.id = l.cliente_id
        LEFT JOIN users u ON u.id = l.apresentador_id
        LEFT JOIN LATERAL (
            SELECT viewer_count, gmv 
            FROM live_snapshots 
            WHERE live_id = c.live_atual_id 
            ORDER BY captured_at DESC LIMIT 1
        ) ls ON true
        ORDER BY c.numero
      `)

      const cabinesFormatadas = cabinesQ.rows.map(c => {
        let duracaoMin = 0;
        if (c.status === 'ao_vivo' && c.iniciado_em) {
          const start = new Date(c.iniciado_em);
          const now = new Date();
          duracaoMin = Math.floor((now - start) / 1000 / 60);
        }
        return {
          numero: c.numero,
          status: c.status,
          live_atual_id: c.live_atual_id,
          viewer_count: Number(c.viewer_count),
          gmv_atual: parseFloat(Number(c.gmv_atual).toFixed(2)),
          cliente_nome: c.cliente_nome,
          apresentador: c.apresentador,
          duracao_min: duracaoMin
        }
      });

      // 3. Resumo do Mês
      const clientesQ = await db.query(`SELECT COUNT(*) AS total FROM clientes WHERE status = 'ativo'`)
      const novosClientesQ = await db.query(`
        SELECT COUNT(*) AS total FROM contratos 
        WHERE date_trunc('month', assinado_em) = date_trunc('month', NOW())
      `)
      // Assumindo que o contrato fica cancelado no churn
      const churnQ = await db.query(`
        SELECT COUNT(*) AS total FROM contratos 
        WHERE status = 'cancelado' 
      `)
      
      const livesMesQ = await db.query(`
        SELECT COUNT(id) AS lives_mes, COALESCE(SUM(fat_gerado), 0) AS gmv_lives_mes
        FROM lives
        WHERE date_trunc('month', iniciado_em) = date_trunc('month', NOW())
      `)

      const mediaViewersQ = await db.query(`
        SELECT COALESCE(AVG(viewer_count), 0) AS media
        FROM live_snapshots
        WHERE date_trunc('month', captured_at) = date_trunc('month', NOW())
      `)

      // 4. Alertas
      const alertasQ = await db.query(`
        SELECT
          (SELECT COUNT(*) FROM contratos WHERE status = 'em_analise') AS contratos_analise,
          (SELECT COUNT(*) FROM boletos WHERE status IN ('vencido') OR (status = 'pendente' AND vencimento < NOW())) AS boletos_vencidos,
          (SELECT COUNT(*) FROM leads WHERE pego_por IS NULL AND status = 'disponivel') AS leads_disponiveis
      `)
      const alertas = alertasQ.rows[0]

      // 5. Ranking do Dia (GMV gerado nas lives de hoje por cliente)
      const rankingResult = await db.query(`
        SELECT cl.nome, COALESCE(SUM(l.fat_gerado), 0) AS gmv, COUNT(l.id) AS lives
        FROM lives l
        JOIN clientes cl ON cl.id = l.cliente_id
        WHERE date_trunc('day', l.iniciado_em) = date_trunc('day', NOW())
        GROUP BY cl.id, cl.nome
        ORDER BY gmv DESC
        LIMIT 5
      `)

      const rankingDia = rankingResult.rows.map(r => ({
        nome: r.nome,
        gmv: parseFloat(Number(r.gmv).toFixed(2)),
        lives: Number(r.lives)
      }))

      // Montando o Payload final
      return {
        // Financeiro
        fat_total:   parseFloat(fatBruto.toFixed(2)),
        fat_bruto:   parseFloat(fatBruto.toFixed(2)),
        fat_liquido: parseFloat(fatLiquido.toFixed(2)),

        // Cabines
        cabines: cabinesFormatadas,

        // Resumo do mês
        clientes_ativos:   Number(clientesQ.rows[0].total),
        novos_clientes:    Number(novosClientesQ.rows[0].total),
        churn_mes:         Number(churnQ.rows[0].total),
        lives_mes:         Number(livesMesQ.rows[0].lives_mes),
        gmv_lives_mes:     parseFloat(Number(livesMesQ.rows[0].gmv_lives_mes).toFixed(2)),
        media_viewers:     Math.round(Number(mediaViewersQ.rows[0].media)),

        // Alertas
        contratos_analise: Number(alertas.contratos_analise),
        boletos_vencidos:  Number(alertas.boletos_vencidos),
        leads_disponiveis: Number(alertas.leads_disponiveis),

        // Ranking do dia
        ranking_dia: rankingDia
      }
    } catch (error) {
      app.log.error({ err: error }, 'ERRO NA ROTA /v1/home/dashboard')
      throw error
    } finally {
      db.release()
    }
  })
}
