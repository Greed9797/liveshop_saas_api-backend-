import { z } from 'zod'

const iniciarLiveSchema = z.object({
  cabine_id:       z.string().uuid(),
  cliente_id:      z.string().uuid(),
  apresentador_id: z.string().uuid(),
})

const encerrarSchema = z.object({
  fat_gerado: z.number().min(0),
})

export async function cabinesRoutes(app) {
  // GET /v1/cabines
  app.get('/v1/cabines', { preHandler: app.authenticate }, async (request) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      // Expandido para trazer os snapshots de viewer e gmv do tiktok, se ao_vivo
      const result = await db.query(
        `SELECT c.*, l.iniciado_em, l.apresentador_id,
                u.nome AS apresentador_nome, cl.nome AS cliente_nome,
                COALESCE(ls.viewer_count, 0) as viewer_count,
                COALESCE(ls.gmv, 0) as gmv_atual
         FROM cabines c
         LEFT JOIN lives l ON l.id = c.live_atual_id
         LEFT JOIN users u ON u.id = l.apresentador_id
         LEFT JOIN clientes cl ON cl.id = l.cliente_id
         LEFT JOIN LATERAL (
            SELECT viewer_count, gmv 
            FROM live_snapshots 
            WHERE live_id = c.live_atual_id 
            ORDER BY captured_at DESC LIMIT 1
         ) ls ON true
         ORDER BY c.numero`
      )
      return result.rows
    } finally {
      db.release()
    }
  })

  // GET /v1/cabines/:id/historico?dias=90
  app.get('/v1/cabines/:id/historico', { preHandler: app.authenticate }, async (request, reply) => {
    const { tenant_id } = request.user
    const cabineId = request.params.id
    const dias = parseInt(request.query.dias) || 90

    const db = await app.dbTenant(tenant_id)
    try {
      // Verifica se a cabine existe para este tenant
      const cabineResult = await db.query(`SELECT id FROM cabines WHERE id = $1`, [cabineId])
      if (cabineResult.rowCount === 0) {
        return reply.code(404).send({ error: 'Cabine não encontrada' })
      }

      // 1. Top Clientes (últimos X dias)
      const topClientesQ = await db.query(`
        SELECT cl.nome, SUM(l.fat_gerado) as fat_total, COUNT(l.id) as total_lives
        FROM lives l
        JOIN clientes cl ON cl.id = l.cliente_id
        WHERE l.cabine_id = $1 
          AND l.status = 'encerrada'
          AND l.iniciado_em > NOW() - INTERVAL '${dias} days'
        GROUP BY cl.id, cl.nome
        ORDER BY fat_total DESC
        LIMIT 5
      `, [cabineId])

      // 2. Melhores Horários
      const melhoresHorariosQ = await db.query(`
        SELECT
          EXTRACT(HOUR FROM iniciado_em) AS hora,
          COUNT(*) AS total_lives,
          AVG(fat_gerado) AS gmv_medio,
          SUM(fat_gerado) AS gmv_total
        FROM lives
        WHERE cabine_id = $1
          AND status = 'encerrada'
          AND iniciado_em > NOW() - INTERVAL '${dias} days'
        GROUP BY hora
        ORDER BY gmv_medio DESC
      `, [cabineId])

      // 3. Desempenho Mensal (Mês atual vs Mês anterior)
      const desempenhoMensalQ = await db.query(`
        SELECT 
          EXTRACT(MONTH FROM iniciado_em) as mes,
          EXTRACT(YEAR FROM iniciado_em) as ano,
          SUM(fat_gerado) as fat_total,
          COUNT(id) as total_lives
        FROM lives
        WHERE cabine_id = $1 AND status = 'encerrada'
        GROUP BY ano, mes
        ORDER BY ano DESC, mes DESC
        LIMIT 6
      `, [cabineId])

      const desempenho = desempenhoMensalQ.rows
      let crescimento_pct = 0
      
      if (desempenho.length >= 2) {
        const atual = parseFloat(desempenho[0].fat_total)
        const anterior = parseFloat(desempenho[1].fat_total)
        if (anterior > 0) {
          crescimento_pct = ((atual - anterior) / anterior) * 100
        }
      }

      // Totais históricos da cabine
      const totaisQ = await db.query(`
        SELECT COUNT(id) as total_lives, SUM(fat_gerado) as gmv_total
        FROM lives WHERE cabine_id = $1 AND status = 'encerrada'
      `, [cabineId])

      return {
        top_clientes: topClientesQ.rows.map(r => ({
          nome: r.nome,
          fat_total: parseFloat(r.fat_total),
          total_lives: parseInt(r.total_lives)
        })),
        melhores_horarios: melhoresHorariosQ.rows.map(r => ({
          hora: `${String(r.hora).padStart(2, '0')}h - ${String(parseInt(r.hora)+2).padStart(2, '0')}h`,
          total_lives: parseInt(r.total_lives),
          gmv_medio: parseFloat(r.gmv_medio),
          gmv_total: parseFloat(r.gmv_total)
        })),
        desempenho_mensal: {
          meses: desempenho.map(r => ({
            mes: `${r.mes}/${r.ano}`,
            fat_total: parseFloat(r.fat_total),
            total_lives: parseInt(r.total_lives)
          })),
          crescimento_pct: parseFloat(crescimento_pct.toFixed(1))
        },
        totais: {
          total_lives: parseInt(totaisQ.rows[0].total_lives || 0),
          gmv_total: parseFloat(totaisQ.rows[0].gmv_total || 0)
        }
      }
    } finally {
      db.release()
    }
  })

  // GET /v1/cabines/:id/live-atual
  app.get('/v1/cabines/:id/live-atual', { preHandler: app.authenticate }, async (request, reply) => {
    const { tenant_id } = request.user
    const cabineId = request.params.id

    const db = await app.dbTenant(tenant_id)
    try {
      // Pega a live atual da cabine
      const cabineQ = await db.query(`SELECT live_atual_id, status FROM cabines WHERE id = $1`, [cabineId])
      const cabine = cabineQ.rows[0]

      if (!cabine) return reply.code(404).send({ error: 'Cabine não encontrada' })
      if (cabine.status !== 'ao_vivo' || !cabine.live_atual_id) {
        return reply.code(400).send({ error: 'Cabine não está ao vivo no momento' })
      }

      const liveId = cabine.live_atual_id

      // 1. Pega dados da Live e relacionamentos
      const liveQ = await db.query(`
        SELECT l.iniciado_em, l.fat_gerado,
               u.nome AS apresentador_nome, 
               cl.nome AS cliente_nome
        FROM lives l
        JOIN users u ON u.id = l.apresentador_id
        JOIN clientes cl ON cl.id = l.cliente_id
        WHERE l.id = $1
      `, [liveId])
      const liveData = liveQ.rows[0]

      // 2. Pega último snapshot
      const snapshotQ = await db.query(`
        SELECT viewer_count, total_orders, gmv, captured_at
        FROM live_snapshots
        WHERE live_id = $1
        ORDER BY captured_at DESC LIMIT 1
      `, [liveId])
      const snapshot = snapshotQ.rows[0] || { viewer_count: 0, total_orders: 0, gmv: 0 }

      // 3. Pega Top Produto da live atual
      const topProdutoQ = await db.query(`
        SELECT produto_nome, quantidade, valor_total
        FROM live_products
        WHERE live_id = $1
        ORDER BY quantidade DESC LIMIT 1
      `, [liveId])
      const topProduto = topProdutoQ.rows[0]

      // Duração em minutos
      const iniciadoEm = new Date(liveData.iniciado_em)
      const agora = new Date()
      const duracaoMinutos = Math.floor((agora - iniciadoEm) / 1000 / 60)

      return {
        viewer_count: snapshot.viewer_count,
        gmv_atual: parseFloat(snapshot.gmv),
        total_orders: snapshot.total_orders,
        duracao_minutos: duracaoMinutos,
        cliente_nome: liveData.cliente_nome,
        apresentador_nome: liveData.apresentador_nome,
        iniciado_em: liveData.iniciado_em,
        top_produto: topProduto ? {
          nome: topProduto.produto_nome,
          quantidade: topProduto.quantidade,
          valor_total: parseFloat(topProduto.valor_total)
        } : null
      }

    } finally {
      db.release()
    }
  })

  // PATCH /v1/cabines/:id/status
  app.patch('/v1/cabines/:id/status', { preHandler: app.authenticate }, async (request, reply) => {
    const { tenant_id } = request.user
    const { status } = request.body
    if (!['ao_vivo','disponivel','manutencao'].includes(status)) {
      return reply.code(400).send({ error: 'Status inválido' })
    }
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `UPDATE cabines SET status = $1 WHERE id = $2 RETURNING id, numero, status`,
        [status, request.params.id]
      )
      if (!result.rows[0]) return reply.code(404).send({ error: 'Cabine não encontrada' })
      return result.rows[0]
    } finally {
      db.release()
    }
  })

  // POST /v1/lives — inicia live
  app.post('/v1/lives', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = iniciarLiveSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.errors[0].message })

    const { tenant_id } = request.user
    const { cabine_id, cliente_id, apresentador_id } = parsed.data

    const db = await app.dbTenant(tenant_id)
    try {
      // Verifica cabine disponível
      const cabineQ = await db.query(
        `SELECT id, status FROM cabines WHERE id = $1 FOR UPDATE`, [cabine_id]
      )
      const cabine = cabineQ.rows[0]
      if (!cabine) return reply.code(404).send({ error: 'Cabine não encontrada' })
      if (cabine.status !== 'disponivel') {
        return reply.code(409).send({ error: 'Cabine não está disponível' })
      }

      // Cria live
      const liveQ = await db.query(
        `INSERT INTO lives (tenant_id, cabine_id, cliente_id, apresentador_id)
         VALUES ($1, $2, $3, $4) RETURNING id, iniciado_em`,
        [tenant_id, cabine_id, cliente_id, apresentador_id]
      )
      const live = liveQ.rows[0]

      // Atualiza cabine
      await db.query(
        `UPDATE cabines SET status = 'ao_vivo', live_atual_id = $1 WHERE id = $2`,
        [live.id, cabine_id]
      )

      return reply.code(201).send(live)
    } finally {
      db.release()
    }
  })

  // GET /v1/lives
  app.get('/v1/lives', { preHandler: app.authenticate }, async (request) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `SELECT l.*, c.numero AS cabine_numero, cl.nome AS cliente_nome,
                u.nome AS apresentador_nome
         FROM lives l
         JOIN cabines c ON c.id = l.cabine_id
         JOIN clientes cl ON cl.id = l.cliente_id
         JOIN users u ON u.id = l.apresentador_id
         ORDER BY l.iniciado_em DESC LIMIT 100`
      )
      return result.rows
    } finally {
      db.release()
    }
  })

  // PATCH /v1/lives/:id/encerrar
  app.patch('/v1/lives/:id/encerrar', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = encerrarSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.errors[0].message })

    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      // Busca live
      const liveQ = await db.query(
        `SELECT l.*, c.comissao_pct FROM lives l
         JOIN contratos c ON c.cliente_id = l.cliente_id AND c.status = 'ativo'
         WHERE l.id = $1 AND l.status = 'em_andamento'`,
        [request.params.id]
      )
      const live = liveQ.rows[0]
      if (!live) return reply.code(400).send({ error: 'Live não encontrada ou já encerrada' })

      const comissao = parsed.data.fat_gerado * (Number(live.comissao_pct ?? 0) / 100)

      await db.query(
        `UPDATE lives SET status = 'encerrada', encerrado_em = NOW(),
          fat_gerado = $1, comissao_calculada = $2
         WHERE id = $3`,
        [parsed.data.fat_gerado, comissao, request.params.id]
      )

      // Libera cabine
      await db.query(
        `UPDATE cabines SET status = 'disponivel', live_atual_id = NULL
         WHERE id = $1`, [live.cabine_id]
      )

      return { ok: true, fat_gerado: parsed.data.fat_gerado, comissao_calculada: comissao }
    } finally {
      db.release()
    }
  })
}
