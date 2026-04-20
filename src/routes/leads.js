export async function leadsRoutes(app) {
  const leadsAccess = [app.authenticate, app.requirePapel(['franqueador_master', 'franqueado', 'gerente'])]

  // GET /v1/leads
  app.get('/v1/leads', { preHandler: leadsAccess }, async (request) => {
    const { tenant_id } = request.user
    const result = await app.db.query(
      `SELECT id, nome, nicho, cidade, estado, lat, lng, fat_estimado,
              status, pego_por, pego_em, expira_em, criado_em,
              (NOW() - criado_em) < interval '24 hours' AS is_novo
        FROM leads
       WHERE franqueadora_id = $1
         AND (status = 'disponivel' OR pego_por = $1)
        ORDER BY
          CASE WHEN status = 'disponivel' THEN 0 ELSE 1 END,
          criado_em DESC`,
      [tenant_id]
    )
    return result.rows
  })

  // POST /v1/leads/:id/pegar
  app.post('/v1/leads/:id/pegar', { preHandler: leadsAccess }, async (request, reply) => {
    const { tenant_id } = request.user

    // Usa transação com SELECT FOR UPDATE para evitar race condition
    const client = await app.db.pool.connect()
    try {
      await client.query('BEGIN')
      const q = await client.query(
        `SELECT id, status FROM leads
         WHERE id = $1 AND franqueadora_id = $2
         FOR UPDATE`,
        [request.params.id, tenant_id]
      )
      const lead = q.rows[0]
      if (!lead) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Lead não encontrado' }) }
      if (lead.status !== 'disponivel') { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Lead já foi pego' }) }

      await client.query(
        `UPDATE leads SET status = 'pego', pego_por = $1,
          pego_em = NOW(), expira_em = NOW() + interval '24 hours'
         WHERE id = $2`,
        [tenant_id, request.params.id]
      )
      await client.query('COMMIT')
      return { ok: true }
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  })

  // GET /v1/leads/meus
  app.get('/v1/leads/meus', { preHandler: leadsAccess }, async (request) => {
    const { tenant_id } = request.user
    const result = await app.db.query(
      `SELECT id, nome, nicho, cidade, estado, lat, lng, fat_estimado,
              status, pego_em, expira_em
       FROM leads WHERE pego_por = $1 ORDER BY pego_em DESC`,
      [tenant_id]
    )
    return result.rows
  })
}
