export async function boletosRoutes(app) {
  // GET /v1/boletos
  app.get('/v1/boletos', { preHandler: app.authenticate }, async (request) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      // Marca boletos vencidos automaticamente
      await db.query(
        `UPDATE boletos SET status = 'vencido'
         WHERE status = 'pendente' AND vencimento < CURRENT_DATE`
      )
      const result = await db.query(
        `SELECT id, tipo, valor, vencimento, status, pago_em, referencia_externa, competencia
         FROM boletos ORDER BY vencimento DESC`
      )
      return result.rows
    } finally {
      db.release()
    }
  })

  // GET /v1/boletos/:id
  app.get('/v1/boletos/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `SELECT * FROM boletos WHERE id = $1`, [request.params.id]
      )
      if (!result.rows[0]) return reply.code(404).send({ error: 'Boleto não encontrado' })
      return { ...result.rows[0], url_boleto: `https://sandbox.pagar.me/boletos/${result.rows[0].referencia_externa ?? result.rows[0].id}` }
    } finally {
      db.release()
    }
  })

  // PATCH /v1/boletos/:id/pagar (dev manual)
  app.patch('/v1/boletos/:id/pagar', { preHandler: app.authenticate }, async (request, reply) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `UPDATE boletos SET status = 'pago', pago_em = NOW()
         WHERE id = $1 AND status != 'pago' RETURNING id, status, pago_em`,
        [request.params.id]
      )
      if (!result.rows[0]) return reply.code(400).send({ error: 'Boleto não encontrado ou já pago' })
      return result.rows[0]
    } finally {
      db.release()
    }
  })

  // POST /v1/webhooks/pagamento (Pagar.me webhook)
  app.post('/v1/webhooks/pagamento', async (request, reply) => {
    const { id, status } = request.body ?? {}
    if (!id || !status) return reply.code(400).send({ error: 'Payload inválido' })

    if (status === 'paid') {
      await app.db.query(
        `UPDATE boletos SET status = 'pago', pago_em = NOW()
         WHERE referencia_externa = $1 AND status != 'pago'`,
        [id]
      )
    }
    return { received: true }
  })
}
