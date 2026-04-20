import bcrypt from 'bcrypt'
import crypto from 'node:crypto'
import { z } from 'zod'

const convidarSchema = z.object({
  nome: z.string().min(2),
  email: z.string().email(),
  papel: z.enum(['gerente', 'apresentador']),
})

export async function usuariosRoutes(app) {
  // GET /v1/usuarios — list tenant users (exclude self)
  app.get('/v1/usuarios', {
    preHandler: [app.authenticate, app.requirePapel(['franqueado', 'franqueador_master'])],
  }, async (request, reply) => {
    const db = await app.dbTenant(request.user.tenant_id)
    try {
      const result = await db.query(
        `SELECT id, nome, email, papel, ativo, criado_em
         FROM users
         WHERE tenant_id = $1 AND id != $2
         ORDER BY criado_em DESC`,
        [request.user.tenant_id, request.user.sub]
      )
      return result.rows
    } finally {
      db.release()
    }
  })

  // POST /v1/usuarios/convidar — create user with temp password
  app.post('/v1/usuarios/convidar', {
    preHandler: [app.authenticate, app.requirePapel(['franqueado', 'franqueador_master'])],
  }, async (request, reply) => {
    const parsed = convidarSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message })
    }
    const { nome, email, papel } = parsed.data

    const db = await app.dbTenant(request.user.tenant_id)
    try {
      // Check duplicate email globally (email has a global UNIQUE constraint)
      const existing = await app.db.query('SELECT id FROM users WHERE email = $1', [email])
      if (existing.rows.length > 0) {
        return reply.code(409).send({ error: 'E-mail já cadastrado' })
      }

      const senhaTemp = crypto.randomBytes(8).toString('hex')
      const senhaHash = await bcrypt.hash(senhaTemp, 12)

      const result = await db.query(
        `INSERT INTO users (tenant_id, nome, email, senha_hash, papel, ativo)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id, nome, email, papel, ativo, criado_em`,
        [request.user.tenant_id, nome, email, senhaHash, papel]
      )
      return reply.code(201).send({ ...result.rows[0], senha_temporaria: senhaTemp })
    } finally {
      db.release()
    }
  })

  // DELETE /v1/usuarios/:id — remove user (not self)
  app.delete('/v1/usuarios/:id', {
    preHandler: [app.authenticate, app.requirePapel(['franqueado', 'franqueador_master'])],
  }, async (request, reply) => {
    if (request.params.id === request.user.sub) {
      return reply.code(400).send({ error: 'Não é possível remover a si mesmo' })
    }
    const db = await app.dbTenant(request.user.tenant_id)
    try {
      const result = await db.query(
        'DELETE FROM users WHERE id = $1 AND tenant_id = $2 RETURNING id',
        [request.params.id, request.user.tenant_id]
      )
      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Usuário não encontrado' })
      }
      return reply.code(204).send()
    } finally {
      db.release()
    }
  })
}
