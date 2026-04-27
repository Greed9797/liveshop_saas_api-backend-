export async function clientePortalRoutes(app) {
  // Helper: resolve cliente_id from authenticated email
  async function getClienteId(db, email) {
    const res = await db.query('SELECT id FROM clientes WHERE email = $1 LIMIT 1', [email])
    return res.rows[0]?.id ?? null
  }

  // Helper: build date range in America/Sao_Paulo timezone
  function buildDateRange(periodo) {
    const now = new Date()
    // Current time in São Paulo
    const spNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    const year = spNow.getFullYear()
    const month = spNow.getMonth() // 0-indexed
    const day = spNow.getDate()

    let start, end
    if (periodo === 'hoje') {
      start = new Date(year, month, day)
      end = new Date(year, month, day + 1)
    } else if (periodo === '7dias') {
      end = new Date(year, month, day + 1)
      start = new Date(year, month, day - 6)
    } else if (periodo === '30dias') {
      end = new Date(year, month, day + 1)
      start = new Date(year, month, day - 29)
    } else {
      // mes_atual (default)
      start = new Date(year, month, 1)
      end = new Date(year, month + 1, 1)
    }

    // Convert local dates back to ISO strings for PG (they represent SP midnight)
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      year,
      month: month + 1, // 1-indexed
      day,
      daysInMonth: new Date(year, month + 1, 0).getDate(),
    }
  }

  // GET /v1/cliente/meta
  app.get('/v1/cliente/meta', {
    preHandler: [app.authenticate, app.requirePapel(['cliente_parceiro'])],
  }, async (request, reply) => {
    const ano = parseInt(request.query.ano)
    const mes = parseInt(request.query.mes)

    if (!ano || !mes || mes < 1 || mes > 12) {
      return reply.code(400).send({ error: 'Parâmetros ano e mes são obrigatórios (mes: 1-12)' })
    }

    const db = await app.dbTenant(request.user.tenant_id)
    try {
      const clienteId = await getClienteId(db, request.user.email)
      if (!clienteId) return reply.code(404).send({ error: 'Cliente não encontrado' })

      const res = await db.query(
        'SELECT meta_gmv FROM cliente_metas WHERE cliente_id = $1 AND ano = $2 AND mes = $3',
        [clienteId, ano, mes]
      )

      const meta_gmv = res.rows[0] ? parseFloat(res.rows[0].meta_gmv) : 0
      return reply.send({ ano, mes, meta_gmv })
    } finally {
      db.release()
    }
  })

  // PATCH /v1/cliente/meta
  app.patch('/v1/cliente/meta', {
    preHandler: [app.authenticate, app.requirePapel(['cliente_parceiro'])],
  }, async (request, reply) => {
    const { ano, mes, meta_gmv } = request.body ?? {}

    if (!ano || !mes || mes < 1 || mes > 12 || meta_gmv == null || isNaN(parseFloat(meta_gmv))) {
      return reply.code(400).send({ error: 'Campos obrigatórios: ano, mes (1-12), meta_gmv' })
    }

    const db = await app.dbTenant(request.user.tenant_id)
    try {
      const clienteId = await getClienteId(db, request.user.email)
      if (!clienteId) return reply.code(404).send({ error: 'Cliente não encontrado' })

      const res = await db.query(
        `INSERT INTO cliente_metas (cliente_id, ano, mes, meta_gmv)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (cliente_id, ano, mes)
         DO UPDATE SET meta_gmv = EXCLUDED.meta_gmv, atualizado_em = NOW()
         RETURNING ano, mes, meta_gmv`,
        [clienteId, ano, mes, parseFloat(meta_gmv)]
      )

      const row = res.rows[0]
      return reply.send({ ano: row.ano, mes: row.mes, meta_gmv: parseFloat(row.meta_gmv) })
    } finally {
      db.release()
    }
  })

  // GET /v1/cliente/dashboard
  app.get('/v1/cliente/dashboard', {
    preHandler: [app.authenticate, app.requirePapel(['cliente_parceiro'])],
  }, async (request, reply) => {
    const periodo = request.query.periodo ?? 'mes_atual'
    const validPeriodos = ['hoje', '7dias', '30dias', 'mes_atual']
    if (!validPeriodos.includes(periodo)) {
      return reply.code(400).send({ error: `periodo inválido. Use: ${validPeriodos.join(', ')}` })
    }

    const db = await app.dbTenant(request.user.tenant_id)
    try {
      const clienteId = await getClienteId(db, request.user.email)
      if (!clienteId) return reply.code(404).send({ error: 'Cliente não encontrado' })

      const range = buildDateRange(periodo)

      // GMV total, total_lives, horas_live
      const livesRes = await db.query(
        `SELECT
           COALESCE(SUM(fat_gerado), 0) AS gmv_total,
           COUNT(*) AS total_lives,
           COALESCE(SUM(EXTRACT(EPOCH FROM (encerrado_em - iniciado_em)) / 3600), 0) AS horas_live
         FROM lives
         WHERE cliente_id = $1
           AND status = 'encerrada'
           AND iniciado_em AT TIME ZONE 'America/Sao_Paulo' >= $2
           AND iniciado_em AT TIME ZONE 'America/Sao_Paulo' < $3`,
        [clienteId, range.start, range.end]
      )
      const livesRow = livesRes.rows[0]
      const gmv_total = parseFloat(livesRow.gmv_total)
      const total_lives = parseInt(livesRow.total_lives)
      const horas_live = parseFloat(livesRow.horas_live)

      // Meta do mês atual (always current month regardless of filter)
      const metaRes = await db.query(
        `SELECT meta_gmv FROM cliente_metas
         WHERE cliente_id = $1
           AND ano = EXTRACT(YEAR FROM NOW() AT TIME ZONE 'America/Sao_Paulo')
           AND mes = EXTRACT(MONTH FROM NOW() AT TIME ZONE 'America/Sao_Paulo')`,
        [clienteId]
      )
      const meta_gmv = metaRes.rows[0] ? parseFloat(metaRes.rows[0].meta_gmv) : 0

      // Próximas lives (live_requests aprovadas ou pendentes, futuras)
      const proximasRes = await db.query(
        `SELECT lr.id, lr.data_solicitada, lr.hora_inicio, lr.hora_fim,
                c.numero AS cabine_numero, lr.status, lr.observacoes
         FROM live_requests lr
         LEFT JOIN cabines c ON c.id = lr.cabine_id
         WHERE lr.cliente_id = $1
           AND lr.data_solicitada >= CURRENT_DATE
           AND lr.status IN ('pendente', 'aprovada')
         ORDER BY lr.data_solicitada, lr.hora_inicio
         LIMIT 5`,
        [clienteId]
      )
      const proximas_lives = proximasRes.rows

      // Pendentes aguardando aprovação
      const pendentesRes = await db.query(
        `SELECT COUNT(*) AS pendentes_aprovacao
         FROM live_requests
         WHERE cliente_id = $1 AND status = 'pendente'`,
        [clienteId]
      )
      const pendentes_aprovacao = parseInt(pendentesRes.rows[0].pendentes_aprovacao)

      // Calculations
      const ticket_medio = total_lives > 0 ? gmv_total / total_lives : 0
      const pct_meta = meta_gmv > 0 ? (gmv_total / meta_gmv) * 100 : 0
      const gmv_faltante = Math.max(0, meta_gmv - gmv_total)

      let projecao_mes = gmv_total
      if (periodo === 'mes_atual' && range.day > 0) {
        const media_diaria = gmv_total / range.day
        projecao_mes = media_diaria * range.daysInMonth
      }

      let status_meta
      if (pct_meta >= 100) {
        status_meta = 'acima_da_meta'
      } else if (meta_gmv > 0 && projecao_mes >= meta_gmv * 0.9) {
        status_meta = 'dentro_do_ritmo'
      } else if (meta_gmv > 0 && projecao_mes >= meta_gmv * 0.6) {
        status_meta = 'abaixo_do_ritmo'
      } else {
        status_meta = 'critico'
      }

      return reply.send({
        periodo,
        gmv_total,
        total_lives,
        horas_live: parseFloat(horas_live.toFixed(2)),
        total_pedidos: 0,
        ticket_medio: parseFloat(ticket_medio.toFixed(2)),
        meta_gmv,
        pct_meta: parseFloat(pct_meta.toFixed(2)),
        gmv_faltante: parseFloat(gmv_faltante.toFixed(2)),
        projecao_mes: parseFloat(projecao_mes.toFixed(2)),
        status_meta,
        proximas_lives,
        pendentes_aprovacao,
      })
    } finally {
      db.release()
    }
  })

  // GET /v1/cliente/agenda
  app.get('/v1/cliente/agenda', {
    preHandler: [app.authenticate, app.requirePapel(['cliente_parceiro'])],
  }, async (request, reply) => {
    // Parse and default date range to current week Mon–Sun
    let { data_inicio, data_fim } = request.query

    if (!data_inicio || !data_fim) {
      const now = new Date()
      const spNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
      const day = spNow.getDay() // 0=Sun
      const diffToMon = (day === 0 ? -6 : 1 - day)
      const mon = new Date(spNow)
      mon.setDate(spNow.getDate() + diffToMon)
      const sun = new Date(mon)
      sun.setDate(mon.getDate() + 6)
      const fmt = (d) => d.toISOString().slice(0, 10)
      data_inicio = data_inicio ?? fmt(mon)
      data_fim = data_fim ?? fmt(sun)
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data_inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(data_fim)) {
      return reply.code(400).send({ error: 'data_inicio e data_fim devem ser YYYY-MM-DD' })
    }

    // Resolve cliente_id from system db (no RLS yet)
    const sysDb = await app.db.connect()
    let clienteId, tenantId
    try {
      const res = await sysDb.query(
        'SELECT c.id AS cliente_id, c.tenant_id FROM clientes c WHERE c.email = $1 LIMIT 1',
        [request.user.email]
      )
      if (!res.rows[0]) return reply.code(404).send({ error: 'Cliente não encontrado' })
      clienteId = res.rows[0].cliente_id
      tenantId = res.rows[0].tenant_id
    } finally {
      sysDb.release()
    }

    const db = await app.dbTenant(tenantId)
    try {
      // All active cabines for this tenant
      const cabinesRes = await db.query(
        'SELECT id, numero FROM cabines WHERE ativo IS NOT FALSE ORDER BY numero'
      )

      // All live_requests in date range (exclude recusada)
      const slotsRes = await db.query(
        `SELECT lr.id, lr.cabine_id, lr.data_solicitada, lr.hora_inicio, lr.hora_fim,
                lr.status, lr.cliente_id,
                (lr.cliente_id = $1) AS is_mine
         FROM live_requests lr
         WHERE lr.data_solicitada >= $2
           AND lr.data_solicitada <= $3
           AND lr.status != 'recusada'
         ORDER BY lr.data_solicitada, lr.hora_inicio`,
        [clienteId, data_inicio, data_fim]
      )

      const slots = slotsRes.rows.map((r) => {
        const isMine = r.is_mine
        const data = r.data_solicitada instanceof Date
          ? r.data_solicitada.toISOString().slice(0, 10)
          : String(r.data_solicitada).slice(0, 10)
        const horaInicio = String(r.hora_inicio).slice(0, 5)
        const horaFim = String(r.hora_fim).slice(0, 5)

        if (isMine) {
          const mappedStatus = r.status === 'aprovada' ? 'confirmada' : r.status // pendente stays pendente
          return {
            cabine_id: r.cabine_id,
            data,
            hora_inicio: horaInicio,
            hora_fim: horaFim,
            status: mappedStatus,
            is_mine: true,
            solicitacao_id: r.id,
          }
        } else {
          return {
            cabine_id: r.cabine_id,
            data,
            hora_inicio: horaInicio,
            hora_fim: horaFim,
            status: 'ocupado',
            is_mine: false,
          }
        }
      })

      return reply.send({
        cabines: cabinesRes.rows,
        slots,
      })
    } finally {
      db.release()
    }
  })

  // POST /v1/cliente/solicitacao
  app.post('/v1/cliente/solicitacao', {
    preHandler: [app.authenticate, app.requirePapel(['cliente_parceiro'])],
  }, async (request, reply) => {
    const { cabine_id, data_solicitada, hora_inicio, hora_fim, observacoes } = request.body ?? {}

    if (!cabine_id || !data_solicitada || !hora_inicio || !hora_fim) {
      return reply.code(400).send({ error: 'Campos obrigatórios: cabine_id, data_solicitada, hora_inicio, hora_fim' })
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data_solicitada)) {
      return reply.code(400).send({ error: 'data_solicitada deve ser YYYY-MM-DD' })
    }

    // Resolve cliente_id + tenant_id from system db
    const sysDb = await app.db.connect()
    let clienteId, tenantId
    try {
      const res = await sysDb.query(
        'SELECT c.id AS cliente_id, c.tenant_id FROM clientes c WHERE c.email = $1 LIMIT 1',
        [request.user.email]
      )
      if (!res.rows[0]) return reply.code(404).send({ error: 'Cliente não encontrado' })
      clienteId = res.rows[0].cliente_id
      tenantId = res.rows[0].tenant_id
    } finally {
      sysDb.release()
    }

    const db = await app.dbTenant(tenantId)
    try {
      // Check for time overlap conflict
      const conflictRes = await db.query(
        `SELECT id FROM live_requests
         WHERE cabine_id = $1
           AND data_solicitada = $2
           AND status != 'recusada'
           AND hora_inicio < $4
           AND hora_fim > $3
         LIMIT 1`,
        [cabine_id, data_solicitada, hora_inicio, hora_fim]
      )

      if (conflictRes.rows.length > 0) {
        return reply.code(409).send({ error: 'Horário indisponível. Escolha outro horário ou cabine.' })
      }

      // Insert — use observacao (actual column name, no 's')
      const obs = observacoes ?? null
      const insertRes = await db.query(
        `INSERT INTO live_requests (tenant_id, cliente_id, cabine_id, solicitante_id, data_solicitada, hora_inicio, hora_fim, status, observacao)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', $8)
         RETURNING id, status`,
        [tenantId, clienteId, cabine_id, request.user.id, data_solicitada, hora_inicio, hora_fim, obs]
      )

      const row = insertRes.rows[0]
      return reply.code(201).send({
        id: row.id,
        status: row.status,
        message: 'Solicitação enviada! A unidade irá confirmar em breve.',
      })
    } finally {
      db.release()
    }
  })
}
