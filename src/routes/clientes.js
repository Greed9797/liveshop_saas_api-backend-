import { z } from 'zod'

const createSchema = z.object({
  nome:         z.string().min(1),
  celular:      z.string().min(1),
  cpf:          z.string().optional(),
  cnpj:         z.string().optional(),
  razao_social: z.string().optional(),
  email:        z.string().email().optional(),
  fat_anual:    z.number().default(0),
  nicho:        z.string().optional(),
  site:         z.string().optional(),
  vende_tiktok: z.boolean().default(false),
  lat:          z.number().optional(),
  lng:          z.number().optional(),
})

export async function clientesRoutes(app) {
  // POST /v1/clientes
  app.post('/v1/clientes', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.errors[0].message })

    const { tenant_id } = request.user
    const d = parsed.data

    const result = await app.db.query(
      `INSERT INTO clientes (tenant_id, nome, celular, cpf, cnpj, razao_social, email,
        fat_anual, nicho, site, vende_tiktok, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, status, criado_em`,
      [tenant_id, d.nome, d.celular, d.cpf ?? null, d.cnpj ?? null,
       d.razao_social ?? null, d.email ?? null, d.fat_anual,
       d.nicho ?? null, d.site ?? null, d.vende_tiktok,
       d.lat ?? null, d.lng ?? null]
    )
    return reply.code(201).send(result.rows[0])
  })

  // GET /v1/clientes
  app.get('/v1/clientes', { preHandler: app.authenticate }, async (request) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `SELECT id, nome, celular, email, status, lat, lng, fat_anual, nicho,
                score, criado_em
         FROM clientes ORDER BY criado_em DESC`
      )
      return result.rows
    } finally {
      db.release()
    }
  })

  // GET /v1/clientes/:id
  app.get('/v1/clientes/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `SELECT * FROM clientes WHERE id = $1`, [request.params.id]
      )
      if (!result.rows[0]) return reply.code(404).send({ error: 'Cliente não encontrado' })
      return result.rows[0]
    } finally {
      db.release()
    }
  })

  // PATCH /v1/clientes/:id
  app.patch('/v1/clientes/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { tenant_id } = request.user
    const allowed = ['nome','celular','email','fat_anual','nicho','site','vende_tiktok','lat','lng','status']
    const updates = Object.fromEntries(
      Object.entries(request.body).filter(([k]) => allowed.includes(k))
    )
    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'Nenhum campo válido para atualizar' })
    }

    const keys = Object.keys(updates)
    const vals = Object.values(updates)
    const set  = keys.map((k, i) => `${k} = $${i + 1}`).join(', ')

    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `UPDATE clientes SET ${set}, atualizado_em = NOW()
         WHERE id = $${keys.length + 1} RETURNING id, nome, status`,
        [...vals, request.params.id]
      )
      if (!result.rows[0]) return reply.code(404).send({ error: 'Cliente não encontrado' })
      return result.rows[0]
    } finally {
      db.release()
    }
  })
}
