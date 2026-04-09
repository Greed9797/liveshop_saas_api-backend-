import { z } from 'zod'

const createSchema = z.object({
  nome_indicado: z.string().min(1),
  recomendante:  z.string().min(1),
  lat:           z.number().optional(),
  lng:           z.number().optional(),
})

export async function recomendacoesRoutes(app) {
  // GET /v1/recomendacoes
  app.get('/v1/recomendacoes', { preHandler: app.authenticate }, async (request) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `SELECT id, nome_indicado, recomendante, status, lat, lng, convertido_em, criado_em
         FROM recomendacoes ORDER BY criado_em DESC`
      )
      return result.rows
    } finally {
      db.release()
    }
  })

  // POST /v1/recomendacoes
  app.post('/v1/recomendacoes', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.errors[0].message })

    const { tenant_id } = request.user
    const { nome_indicado, recomendante, lat, lng } = parsed.data

    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `INSERT INTO recomendacoes (tenant_id, nome_indicado, recomendante, lat, lng)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, nome_indicado, status`,
        [tenant_id, nome_indicado, recomendante, lat ?? null, lng ?? null]
      )
      return reply.code(201).send(result.rows[0])
    } finally {
      db.release()
    }
  })

  // PATCH /v1/recomendacoes/:id/converter
  app.patch('/v1/recomendacoes/:id/converter', { preHandler: app.authenticate }, async (request, reply) => {
    const { tenant_id } = request.user
    const { cliente_id } = request.body || {}
    const db = await app.dbTenant(tenant_id)
    try {
      const recQ = await db.query(
        `SELECT * FROM recomendacoes WHERE id = $1 AND status = 'pendente'`, [request.params.id]
      )
      const rec = recQ.rows[0]
      if (!rec) return reply.code(400).send({ error: 'Recomendação não encontrada ou já convertida' })

      let finalClienteId = cliente_id

      if (!finalClienteId) {
        // Cria cliente novo
        const clienteQ = await db.query(
          `INSERT INTO clientes (tenant_id, nome, celular, lat, lng)
           VALUES ($1, $2, '', $3, $4) RETURNING id`,
          [tenant_id, rec.nome_indicado, rec.lat, rec.lng]
        )
        finalClienteId = clienteQ.rows[0].id
      } else {
        // Valida se o cliente existe e pertence ao tenant
        const checkQ = await db.query(`SELECT id FROM clientes WHERE id = $1 AND tenant_id = $2`, [finalClienteId, tenant_id])
        if (checkQ.rowCount === 0) {
          return reply.code(400).send({ error: 'Cliente selecionado inválido ou inexistente neste tenant' })
        }
      }

      // Marca recomendação como convertida
      await db.query(
        `UPDATE recomendacoes SET status = 'convertido', convertido_em = NOW() WHERE id = $1`,
        [request.params.id]
      )

      return { cliente_id: finalClienteId }
    } finally {
      db.release()
    }
  })
}
