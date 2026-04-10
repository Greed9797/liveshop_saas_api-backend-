import { z } from 'zod'

const createSchema = z.object({
  cliente_id:   z.string().uuid(),
  valor_fixo:   z.number().min(0),
  comissao_pct: z.number().min(0).max(100),
})

export async function contratosRoutes(app) {
  // POST /v1/contratos
  app.post('/v1/contratos', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.errors[0].message })

    const { tenant_id, sub } = request.user
    const { cliente_id, valor_fixo, comissao_pct } = parsed.data

    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `INSERT INTO contratos (tenant_id, cliente_id, user_id, valor_fixo, comissao_pct)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, status, criado_em`,
        [tenant_id, cliente_id, sub, valor_fixo, comissao_pct]
      )
      return reply.code(201).send(result.rows[0])
    } finally { db.release() }
  })

  // GET /v1/contratos — lista todos os contratos do tenant
  app.get('/v1/contratos', { preHandler: app.authenticate }, async (request) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(`
        SELECT c.id, c.status, c.valor_fixo, c.comissao_pct,
               c.de_risco, c.assinado_em, c.ativado_em, c.cancelado_em,
               c.criado_em,
               cl.nome AS cliente_nome, cl.cnpj AS cliente_cnpj,
               cl.nicho AS cliente_nicho
        FROM contratos c
        JOIN clientes cl ON cl.id = c.cliente_id
        ORDER BY c.criado_em DESC
      `)
      return result.rows
    } finally { db.release() }
  })

  // GET /v1/contratos/:id — detalhe de um contrato
  app.get('/v1/contratos/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(`
        SELECT c.*, cl.nome AS cliente_nome, cl.cnpj AS cliente_cnpj,
               cl.fat_anual AS cliente_fat_anual, cl.nicho AS cliente_nicho,
               cl.score AS cliente_score, cl.email AS cliente_email,
               cl.celular AS cliente_celular
        FROM contratos c
        JOIN clientes cl ON cl.id = c.cliente_id
        WHERE c.id = $1
      `, [request.params.id])
      if (!result.rows[0]) return reply.code(404).send({ error: 'Contrato não encontrado' })
      return result.rows[0]
    } finally { db.release() }
  })

  // POST /v1/contratos/:id/assinar → em_analise
  app.post('/v1/contratos/:id/assinar', { preHandler: app.authenticate }, async (request, reply) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `UPDATE contratos
         SET status = 'em_analise', assinado_em = NOW()
         WHERE id = $1 AND status = 'rascunho'
         RETURNING id, status, assinado_em`,
        [request.params.id]
      )
      if (!result.rows[0]) return reply.code(400).send({ error: 'Contrato não encontrado ou já assinado' })
      return result.rows[0]
    } finally {
      db.release()
    }
  })

  // POST /v1/contratos/:id/assinar-digital
  app.post('/v1/contratos/:id/assinar-digital', { preHandler: app.authenticate }, async (request, reply) => {
    const { tenant_id } = request.user
    const { signatureImageBase64, acceptedTerms } = request.body ?? {}

    if (!acceptedTerms) {
      return reply.code(400).send({ error: 'É necessário aceitar os termos para assinar' })
    }
    if (!signatureImageBase64) {
      return reply.code(400).send({ error: 'Imagem da assinatura é obrigatória' })
    }

    const db = await app.dbTenant(tenant_id)
    try {
      const q = await db.query(
        `SELECT c.id, c.status, c.cliente_id,
                cl.fat_anual, cl.cnpj, cl.score as cliente_score
         FROM contratos c JOIN clientes cl ON cl.id = c.cliente_id
         WHERE c.id = $1 AND c.status = 'rascunho'`,
        [request.params.id]
      )
      const contrato = q.rows[0]
      if (!contrato) {
        return reply.code(400).send({ error: 'Contrato não encontrado ou não está em rascunho' })
      }

      // Score interno (Auditoria Comercial)
      let score = 0
      if (Number(contrato.fat_anual) > 50000) score += 50
      if (contrato.cnpj) score += 20
      if ((contrato.cliente_score ?? 0) >= 70) score += 30

      const aprovado = score >= 60
      const novoStatus = aprovado ? 'ativo' : 'em_analise'
      const signatureUrl = `data:image/png;base64,${signatureImageBase64}`
      const clientIp = request.headers['x-forwarded-for']?.split(',')[0]?.trim()
                    || request.socket?.remoteAddress
                    || 'unknown'

      await db.query('BEGIN')
      try {
        await db.query(
          `UPDATE contratos
           SET status = $1,
               signature_type = 'pad',
               signature_image_url = $2,
               signed_ip = $3,
               accepted_terms_at = NOW(),
               assinado_em = NOW(),
               ativado_em = $4
           WHERE id = $5`,
          [novoStatus, signatureUrl, clientIp, aprovado ? new Date() : null, request.params.id]
        )

        if (aprovado) {
          await db.query(
            `UPDATE clientes SET status = 'ativo' WHERE id = $1`,
            [contrato.cliente_id]
          )
        }
        await db.query('COMMIT')
      } catch (txErr) {
        await db.query('ROLLBACK')
        throw txErr
      }

      return { aprovado, score, status: novoStatus, requer_backoffice: !aprovado }
    } finally {
      db.release()
    }
  })

  // POST /v1/contratos/:id/analisar → score automático → ativo ou cancelado
  app.post('/v1/contratos/:id/analisar', { preHandler: app.authenticate }, async (request, reply) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      // Busca contrato + cliente
      const q = await db.query(
        `SELECT c.*, cl.fat_anual, cl.cnpj, cl.score as cliente_score
         FROM contratos c JOIN clientes cl ON cl.id = c.cliente_id
         WHERE c.id = $1 AND c.status = 'em_analise'`,
        [request.params.id]
      )
      const contrato = q.rows[0]
      if (!contrato) return reply.code(400).send({ error: 'Contrato não em análise' })

      // Score: fat_anual > 50000 = +50, cnpj presente = +20, score do cliente >= 70 = +30
      let score = 0
      if (Number(contrato.fat_anual) > 50000) score += 50
      if (contrato.cnpj) score += 20
      if ((contrato.cliente_score ?? 0) >= 70) score += 30

      const aprovado = score >= 60
      const novoStatus = aprovado ? 'ativo' : 'cancelado'

      await db.query(
        `UPDATE contratos SET status = $1, ativado_em = $2, cancelado_em = $3 WHERE id = $4`,
        [novoStatus,
         aprovado ? new Date() : null,
         aprovado ? null : new Date(),
         request.params.id]
      )

      return { aprovado, score, status: novoStatus }
    } finally {
      db.release()
    }
  })

  // PATCH /v1/contratos/:id/assumir-risco → ativo forçado
  app.patch('/v1/contratos/:id/assumir-risco', {
    preHandler: app.requirePapel(['franqueador_master', 'franqueado']),
  }, async (request, reply) => {
    const { confirmacao, senha } = request.body ?? {}
    if (!confirmacao || confirmacao.toUpperCase() !== 'CONCORDO') {
      return reply.code(400).send({ error: 'Confirmação inválida' })
    }
    if (!senha) {
      return reply.code(400).send({ error: 'Senha é obrigatória' })
    }

    const { tenant_id, sub } = request.user

    // Valida senha do usuário
    const userQ = await app.db.query(
      `SELECT senha_hash FROM users WHERE id = $1`, [sub]
    )
    if (!userQ.rows[0]) {
      return reply.code(400).send({ error: 'Usuário não encontrado' })
    }

    const { default: bcrypt } = await import('bcrypt')
    const senhaOk = await bcrypt.compare(senha, userQ.rows[0].senha_hash)
    if (!senhaOk) {
      return reply.code(400).send({ error: 'Senha inválida' })
    }

    const db = await app.dbTenant(tenant_id)
    try {
      await db.query('BEGIN')
      try {
        const result = await db.query(
          `UPDATE contratos SET de_risco = true, is_risco_franqueado = true,
                  status = 'ativo', ativado_em = NOW(), risco_assumido_em = NOW()
           WHERE id = $1 AND status IN ('em_analise', 'cancelado')
           RETURNING id, cliente_id, status, de_risco`,
          [request.params.id]
        )
        if (!result.rows[0]) {
          await db.query('ROLLBACK')
          return reply.code(400).send({ error: 'Contrato não encontrado ou não está em análise' })
        }

        await db.query(
          `UPDATE clientes SET status = 'ativo' WHERE id = $1`,
          [result.rows[0].cliente_id]
        )
        await db.query('COMMIT')
      } catch (txErr) {
        await db.query('ROLLBACK')
        throw txErr
      }
      return { ok: true, status: 'ativo', de_risco: true }
    } finally {
      db.release()
    }
  })

  // PATCH /v1/contratos/:id/cancelar
  app.patch('/v1/contratos/:id/cancelar', { preHandler: app.authenticate }, async (request, reply) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `UPDATE contratos SET status = 'cancelado', cancelado_em = NOW()
         WHERE id = $1 AND status != 'cancelado' RETURNING id, status`,
        [request.params.id]
      )
      if (!result.rows[0]) return reply.code(400).send({ error: 'Contrato não encontrado ou já cancelado' })
      return result.rows[0]
    } finally {
      db.release()
    }
  })

  // GET /v1/analise-credito
  app.get('/v1/analise-credito', { preHandler: app.authenticate }, async (request) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `SELECT c.id, c.status, c.valor_fixo, c.comissao_pct,
                c.is_risco_franqueado, c.risco_assumido_em,
                c.arquivado_em, c.arquivado_motivo, c.assinado_em,
                cl.nome, cl.cnpj, cl.fat_anual, cl.nicho, cl.score,
                cl.razao_social
         FROM contratos c
         JOIN clientes cl ON cl.id = c.cliente_id
         WHERE c.tenant_id = $1
           AND c.status IN ('em_analise', 'ativo', 'arquivado')
         ORDER BY c.assinado_em DESC NULLS LAST`,
        [tenant_id]
      )
      return result.rows
    } finally {
      db.release()
    }
  })

  // PATCH /v1/contratos/:id/aprovar
  app.patch('/v1/contratos/:id/aprovar', {
    preHandler: app.requirePapel(['franqueador_master']),
  }, async (request, reply) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      await db.query('BEGIN')
      try {
        const q = await db.query(
          `UPDATE contratos
           SET status = 'ativo', ativado_em = NOW()
           WHERE id = $1 AND status = 'em_analise'
           RETURNING id, cliente_id`,
          [request.params.id]
        )
        if (!q.rows[0]) {
          await db.query('ROLLBACK')
          return reply.code(400).send({ error: 'Contrato não está em análise' })
        }

        await db.query(
          `UPDATE clientes SET status = 'ativo' WHERE id = $1`,
          [q.rows[0].cliente_id]
        )
        await db.query('COMMIT')
      } catch (txErr) {
        await db.query('ROLLBACK')
        throw txErr
      }
      return { ok: true, status: 'ativo' }
    } finally {
      db.release()
    }
  })

  // PATCH /v1/contratos/:id/arquivar
  app.patch('/v1/contratos/:id/arquivar', {
    preHandler: app.requirePapel(['franqueador_master']),
  }, async (request, reply) => {
    const { tenant_id } = request.user
    const motivo = (request.body ?? {}).motivo ?? null
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `UPDATE contratos
         SET status = 'arquivado', arquivado_em = NOW(), arquivado_motivo = $2
         WHERE id = $1 AND status IN ('em_analise','rascunho')
         RETURNING id, status`,
        [request.params.id, motivo]
      )
      if (!result.rows[0]) return reply.code(400).send({ error: 'Contrato não pode ser arquivado' })
      return result.rows[0]
    } finally {
      db.release()
    }
  })

  // PATCH /v1/contratos/:id/pendencia
  app.patch('/v1/contratos/:id/pendencia', {
    preHandler: app.requirePapel(['franqueador_master']),
  }, async (request, reply) => {
    const motivo = request.body?.motivo
    if (!motivo || motivo.length < 8) {
      return reply.code(400).send({ error: 'Motivo deve ter pelo menos 8 caracteres' })
    }
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `UPDATE contratos SET pendencia_motivo = $2, reviewed_at = NOW()
         WHERE id = $1 AND status = 'em_analise' RETURNING id, status`,
        [request.params.id, motivo]
      )
      if (!result.rows[0]) return reply.code(400).send({ error: 'Contrato não está em análise' })
      return result.rows[0]
    } finally { db.release() }
  })

  // PATCH /v1/contratos/:id/reprovar
  app.patch('/v1/contratos/:id/reprovar', {
    preHandler: app.requirePapel(['franqueador_master']),
  }, async (request, reply) => {
    const motivo = request.body?.motivo
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `UPDATE contratos SET status = 'cancelado', reprovacao_motivo = $2,
         cancelado_em = NOW(), reviewed_at = NOW()
         WHERE id = $1 AND status = 'em_analise' RETURNING id, status`,
        [request.params.id, motivo]
      )
      if (!result.rows[0]) return reply.code(400).send({ error: 'Contrato não está em análise' })
      return result.rows[0]
    } finally { db.release() }
  })

  // PATCH /v1/contratos/:id/sinalizar-risco
  app.patch('/v1/contratos/:id/sinalizar-risco', {
    preHandler: app.requirePapel(['franqueador_master']),
  }, async (request, reply) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      await db.query('BEGIN')
      try {
        const q = await db.query(
          `UPDATE contratos
           SET status = 'ativo',
               is_risco_franqueado = true,
               risco_assumido_em = NOW(),
               ativado_em = NOW()
           WHERE id = $1 AND status = 'em_analise'
           RETURNING id, cliente_id`,
          [request.params.id]
        )
        if (!q.rows[0]) {
          await db.query('ROLLBACK')
          return reply.code(400).send({ error: 'Contrato não está em análise' })
        }

        await db.query(
          `UPDATE clientes SET status = 'ativo' WHERE id = $1`,
          [q.rows[0].cliente_id]
        )
        await db.query('COMMIT')
      } catch (txErr) {
        await db.query('ROLLBACK')
        throw txErr
      }
      return { ok: true, status: 'ativo', is_risco_franqueado: true }
    } finally {
      db.release()
    }
  })
}
