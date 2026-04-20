import { z } from 'zod'

const createSchema = z.object({
  nome:            z.string().min(1),
  descricao:       z.string().optional(),
  valor:           z.number().min(0),
  horas_incluidas: z.number().min(0),
})

const updateSchema = createSchema.partial().extend({
  ativo: z.boolean().optional(),
})

export async function pacotesRoutes(app) {
  // GET /v1/pacotes — list all packages (active + inactive)
  app.get('/v1/pacotes', {
    preHandler: app.requirePapel(['franqueado', 'franqueador_master', 'gerente']),
  }, async (request) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `SELECT id, nome, descricao, valor, horas_incluidas, ativo, criado_em
         FROM pacotes
         ORDER BY ativo DESC, valor ASC`
      )
      return result.rows
    } finally { db.release() }
  })

  // POST /v1/pacotes — create a package
  app.post('/v1/pacotes', {
    preHandler: app.requirePapel(['franqueado', 'franqueador_master', 'gerente']),
  }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message })

    const { tenant_id } = request.user
    const { nome, descricao, valor, horas_incluidas } = parsed.data
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `INSERT INTO pacotes (tenant_id, nome, descricao, valor, horas_incluidas)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, nome, descricao, valor, horas_incluidas, ativo, criado_em`,
        [tenant_id, nome, descricao ?? null, valor, horas_incluidas]
      )
      return reply.code(201).send(result.rows[0])
    } finally { db.release() }
  })

  // PATCH /v1/pacotes/:id — update a package
  app.patch('/v1/pacotes/:id', {
    preHandler: app.requirePapel(['franqueado', 'franqueador_master', 'gerente']),
  }, async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message })

    const { tenant_id } = request.user
    const updates = parsed.data
    const fields = Object.keys(updates)
    if (fields.length === 0) return reply.code(400).send({ error: 'Nenhum campo para atualizar' })

    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
    const values = [request.params.id, ...fields.map((f) => updates[f])]

    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `UPDATE pacotes SET ${setClauses}
         WHERE id = $1
         RETURNING id, nome, descricao, valor, horas_incluidas, ativo`,
        values
      )
      if (!result.rows[0]) return reply.code(404).send({ error: 'Pacote não encontrado' })
      return result.rows[0]
    } finally { db.release() }
  })

  // DELETE /v1/pacotes/:id — deactivate a package
  app.delete('/v1/pacotes/:id', {
    preHandler: app.requirePapel(['franqueado', 'franqueador_master', 'gerente']),
  }, async (request, reply) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `UPDATE pacotes SET ativo = false WHERE id = $1 RETURNING id`,
        [request.params.id]
      )
      if (!result.rows[0]) return reply.code(404).send({ error: 'Pacote não encontrado' })
      return reply.code(204).send()
    } finally { db.release() }
  })
}
