import { z } from 'zod'

const CRM_ETAPAS = ['lead_novo','contato_iniciado','reuniao_agendada','proposta_enviada','em_negociacao','aguardando_assinatura','ganho','perdido']

const crmUpdateSchema = z.object({
  crm_etapa:            z.enum(CRM_ETAPAS).optional(),
  valor_oportunidade:   z.number().min(0).optional(),
  responsavel_nome:     z.string().optional(),
  origem:               z.string().optional(),
  observacoes_internas: z.string().optional(),
  motivo_perda:         z.string().optional(),
})

const contatoSchema = z.object({
  tipo:   z.string().min(1),
  resumo: z.string().min(1),
})

const tarefaSchema = z.object({
  titulo:    z.string().min(1),
  concluida: z.boolean().default(false),
})

const SELECT_CRM = `
  SELECT id, nome, nicho, cidade, estado, lat, lng, fat_estimado,
         status, pego_por, pego_em, expira_em, criado_em, atualizado_em,
         (NOW() - criado_em) < interval '24 hours' AS is_novo,
         crm_etapa, valor_oportunidade, responsavel_nome, origem,
         historico_contatos, observacoes_internas, tarefas,
         motivo_perda, convertido_cliente_id, ganho_em
  FROM leads`

export async function leadsRoutes(app) {
  const access = [app.authenticate, app.requirePapel(['franqueador_master', 'franqueado', 'gerente'])]

  // GET /v1/leads — lista leads do tenant com campos CRM
  app.get('/v1/leads', { preHandler: access }, async (request) => {
    const { tenant_id } = request.user
    const { etapa } = request.query

    let where = `WHERE franqueadora_id = $1 AND status != 'expirado'`
    const params = [tenant_id]

    if (etapa) {
      params.push(etapa)
      where += ` AND crm_etapa = $${params.length}`
    }

    const result = await app.db.query(
      `${SELECT_CRM} ${where} ORDER BY criado_em DESC`,
      params
    )
    return result.rows
  })

  // GET /v1/leads/meus — leads próprios não encerrados
  app.get('/v1/leads/meus', { preHandler: access }, async (request) => {
    const { tenant_id } = request.user
    const result = await app.db.query(
      `${SELECT_CRM}
       WHERE pego_por = $1 AND crm_etapa NOT IN ('ganho','perdido')
       ORDER BY atualizado_em DESC NULLS LAST, pego_em DESC`,
      [tenant_id]
    )
    return result.rows
  })

  // GET /v1/leads/:id — detalhe do lead
  app.get('/v1/leads/:id', { preHandler: access }, async (request, reply) => {
    const { tenant_id } = request.user
    const result = await app.db.query(
      `${SELECT_CRM} WHERE id = $1 AND franqueadora_id = $2`,
      [request.params.id, tenant_id]
    )
    if (!result.rows[0]) return reply.code(404).send({ error: 'Lead não encontrado' })
    return result.rows[0]
  })

  // PATCH /v1/leads/:id — atualiza campos CRM
  app.patch('/v1/leads/:id', { preHandler: access }, async (request, reply) => {
    const parsed = crmUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message })

    const { tenant_id } = request.user
    const updates = parsed.data
    const fields = Object.keys(updates)
    if (fields.length === 0) return reply.code(400).send({ error: 'Nenhum campo para atualizar' })

    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`).join(', ')
    const values = [request.params.id, tenant_id, ...fields.map((f) => updates[f])]

    const result = await app.db.query(
      `UPDATE leads SET ${setClauses}, atualizado_em = NOW()
       WHERE id = $1 AND franqueadora_id = $2
       RETURNING id, crm_etapa, valor_oportunidade, responsavel_nome, origem, motivo_perda`,
      values
    )
    if (!result.rows[0]) return reply.code(404).send({ error: 'Lead não encontrado' })
    return result.rows[0]
  })

  // POST /v1/leads/:id/contato — adiciona entrada no histórico de contatos
  app.post('/v1/leads/:id/contato', { preHandler: access }, async (request, reply) => {
    const parsed = contatoSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message })

    const { tenant_id } = request.user
    const entrada = { ...parsed.data, data: new Date().toISOString() }

    const result = await app.db.query(
      `UPDATE leads
       SET historico_contatos = historico_contatos || $3::jsonb,
           atualizado_em = NOW()
       WHERE id = $1 AND franqueadora_id = $2
       RETURNING id, historico_contatos`,
      [request.params.id, tenant_id, JSON.stringify(entrada)]
    )
    if (!result.rows[0]) return reply.code(404).send({ error: 'Lead não encontrado' })
    return result.rows[0]
  })

  // POST /v1/leads/:id/tarefa — adiciona tarefa ao lead
  app.post('/v1/leads/:id/tarefa', { preHandler: access }, async (request, reply) => {
    const parsed = tarefaSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message })

    const { tenant_id } = request.user
    const tarefa = { ...parsed.data, id: crypto.randomUUID(), criado_em: new Date().toISOString() }

    const result = await app.db.query(
      `UPDATE leads
       SET tarefas = tarefas || $3::jsonb,
           atualizado_em = NOW()
       WHERE id = $1 AND franqueadora_id = $2
       RETURNING id, tarefas`,
      [request.params.id, tenant_id, JSON.stringify(tarefa)]
    )
    if (!result.rows[0]) return reply.code(404).send({ error: 'Lead não encontrado' })
    return result.rows[0]
  })

  // POST /v1/leads/:id/ganhar — converte lead em cliente + contrato ativo
  app.post('/v1/leads/:id/ganhar', { preHandler: access }, async (request, reply) => {
    const { tenant_id } = request.user
    const { pacote_id } = request.body ?? {}

    const client = await app.db.pool.connect()
    try {
      await client.query('BEGIN')

      const leadQ = await client.query(
        `SELECT * FROM leads WHERE id = $1 AND franqueadora_id = $2 FOR UPDATE`,
        [request.params.id, tenant_id]
      )
      const lead = leadQ.rows[0]
      if (!lead) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Lead não encontrado' }) }
      if (lead.crm_etapa === 'ganho') { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Lead já convertido' }) }

      // Cria cliente
      const clienteQ = await client.query(
        `INSERT INTO clientes (tenant_id, nome, nicho, cidade, estado, lat, lng, fat_anual, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ativo')
         RETURNING id`,
        [tenant_id, lead.nome, lead.nicho, lead.cidade, lead.estado, lead.lat, lead.lng, Number(lead.fat_estimado) * 12]
      )
      const clienteId = clienteQ.rows[0].id

      // Obtém dados do pacote para copiar no contrato
      let valorFixo = 0, comissaoPct = 0, horasIncluidas = 0
      if (pacote_id) {
        const pacoteQ = await client.query(
          `SELECT valor_fixo, comissao_pct, horas_incluidas FROM pacotes WHERE id = $1 AND tenant_id = $2`,
          [pacote_id, tenant_id]
        )
        if (pacoteQ.rows[0]) {
          valorFixo = Number(pacoteQ.rows[0].valor_fixo)
          comissaoPct = Number(pacoteQ.rows[0].comissao_pct)
          horasIncluidas = Number(pacoteQ.rows[0].horas_incluidas)
        }
      }

      // Cria contrato ativo
      await client.query(
        `INSERT INTO contratos (tenant_id, cliente_id, pacote_id, valor_fixo, comissao_pct, horas_incluidas, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ativo')`,
        [tenant_id, clienteId, pacote_id ?? null, valorFixo, comissaoPct, horasIncluidas]
      )

      // Marca lead como ganho
      await client.query(
        `UPDATE leads
         SET crm_etapa = 'ganho', status = 'pego', convertido_cliente_id = $3,
             ganho_em = NOW(), atualizado_em = NOW()
         WHERE id = $1 AND franqueadora_id = $2`,
        [request.params.id, tenant_id, clienteId]
      )

      await client.query('COMMIT')
      return { ok: true, cliente_id: clienteId }
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  })

  // POST /v1/leads/:id/pegar — pega lead disponível (fluxo legado)
  app.post('/v1/leads/:id/pegar', { preHandler: access }, async (request, reply) => {
    const { tenant_id } = request.user
    const client = await app.db.pool.connect()
    try {
      await client.query('BEGIN')
      const q = await client.query(
        `SELECT id, status FROM leads WHERE id = $1 AND franqueadora_id = $2 FOR UPDATE`,
        [request.params.id, tenant_id]
      )
      const lead = q.rows[0]
      if (!lead) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Lead não encontrado' }) }
      if (lead.status !== 'disponivel') { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Lead já foi pego' }) }

      await client.query(
        `UPDATE leads SET status = 'pego', pego_por = $1,
          pego_em = NOW(), expira_em = NOW() + interval '24 hours', atualizado_em = NOW()
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
}
