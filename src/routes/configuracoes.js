import { z } from 'zod'

const configSchema = z.object({
  logo_url: z.string().url().or(z.literal('')).optional().nullable(),
  nome: z.string().min(1).optional(),
  asaas_api_key: z.string().optional().nullable(),
  asaas_wallet_id: z.string().optional().nullable(),
  tiktok_access_token: z.string().optional().nullable(),
  tiktok_shop_id: z.string().optional().nullable(),
  nova_senha: z.string().min(6).optional().nullable(),
  meta_diaria_gmv: z.number().positive().optional().nullable(),
})

export async function configuracoesRoutes(app) {
  // GET /v1/configuracoes
  app.get('/v1/configuracoes', { preHandler: app.requirePapel(['franqueado', 'franqueador_master']) }, async (request, reply) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    
    try {
      const { rows } = await db.query(`
        SELECT 
          id, nome, logo_url,
          asaas_api_key, asaas_wallet_id,
          tiktok_access_token, tiktok_shop_id,
          meta_diaria_gmv
        FROM tenants 
        WHERE id = $1
      `, [tenant_id])
      
      const conf = rows[0]
      
      // Ocultar chaves sensíveis parcialmente
      const hideKey = (key) => key && key.length > 8 ? key.substring(0, 4) + '...' + key.substring(key.length - 4) : key

      return {
        id: conf.id,
        nome: conf.nome,
        logo_url: conf.logo_url,
        asaas_api_key_hidden: hideKey(conf.asaas_api_key),
        has_asaas: !!conf.asaas_api_key,
        asaas_wallet_id: conf.asaas_wallet_id,
        has_tiktok: !!conf.tiktok_access_token,
        tiktok_shop_id: conf.tiktok_shop_id,
        meta_diaria_gmv: conf.meta_diaria_gmv ? Number(conf.meta_diaria_gmv) : 10000
      }
    } finally {
      db.release()
    }
  })

  // PATCH /v1/configuracoes
  app.patch('/v1/configuracoes', { preHandler: [app.authenticate, app.requirePapel(['franqueador_master', 'franqueado'])] }, async (request, reply) => {
    const parsed = configSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.errors[0].message })

    const { tenant_id, sub: user_id } = request.user
    const data = parsed.data

    const db = await app.dbTenant(tenant_id)
    try {
      await db.query('BEGIN')

      // 1. Atualizar configs do Tenant
      const updates = []
      const values = [tenant_id]
      let paramIdx = 2

      if (data.nome !== undefined) {
        updates.push(`nome = $${paramIdx++}`)
        values.push(data.nome)
      }
      if (data.logo_url !== undefined) {
        updates.push(`logo_url = $${paramIdx++}`)
        values.push(data.logo_url)
      }
      if (data.asaas_api_key !== undefined) {
        updates.push(`asaas_api_key = $${paramIdx++}`)
        values.push(data.asaas_api_key)
      }
      if (data.asaas_wallet_id !== undefined) {
        updates.push(`asaas_wallet_id = $${paramIdx++}`)
        values.push(data.asaas_wallet_id)
      }
      if (data.tiktok_access_token !== undefined) {
        updates.push(`tiktok_access_token = $${paramIdx++}`)
        values.push(data.tiktok_access_token)
      }
      if (data.tiktok_shop_id !== undefined) {
        updates.push(`tiktok_shop_id = $${paramIdx++}`)
        values.push(data.tiktok_shop_id)
      }
      if (data.meta_diaria_gmv !== undefined) {
        updates.push(`meta_diaria_gmv = $${paramIdx++}`)
        values.push(data.meta_diaria_gmv)
      }

      if (updates.length > 0) {
        await db.query(`UPDATE tenants SET ${updates.join(', ')} WHERE id = $1`, values)
      }

      // 2. Atualizar senha se fornecida
      if (data.nova_senha) {
        const bcrypt = await import('bcrypt')
        const hash = await bcrypt.default.hash(data.nova_senha, 10)
        await db.query(`UPDATE users SET senha_hash = $1 WHERE id = $2 AND tenant_id = $3`, [hash, user_id, tenant_id])
      }

      await db.query('COMMIT')
      return { ok: true, message: 'Configurações atualizadas com sucesso' }
    } catch (e) {
      await db.query('ROLLBACK')
      throw e
    } finally {
      db.release()
    }
  })
}
