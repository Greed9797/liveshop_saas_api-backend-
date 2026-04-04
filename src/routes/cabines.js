import { z } from 'zod'
import { buscarOuCriarCustomer, gerarIdempotencyKey, criarCobranca } from '../services/asaas.js'

const cabineRoleAccess = (app) => [
  app.authenticate,
  app.requirePapel(['franqueador_master', 'franqueado']),
]

const reservarCabineSchema = z.object({
  contrato_id: z.string().uuid(),
})

const iniciarLiveSchema = z.object({
  cabine_id: z.string().uuid(),
})

const encerrarSchema = z.object({
  fat_gerado: z.number().min(0),
})

const atualizarStatusSchema = z.object({
  status: z.enum(['disponivel', 'ativa', 'manutencao']),
})

function getRequestIp(request) {
  const forwardedFor = request.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim()
  }

  return request.socket?.remoteAddress ?? null
}

async function logCabineEvent(db, {
  tenantId,
  cabineId,
  contratoId = null,
  tipoEvento,
  actorUserId = null,
  actorPapel = null,
  ip = null,
  payload = {},
}) {
  await db.query(
    `INSERT INTO cabine_eventos (
      tenant_id,
      cabine_id,
      contrato_id,
      tipo_evento,
      actor_user_id,
      actor_papel,
      ip,
      payload_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      tenantId,
      cabineId,
      contratoId,
      tipoEvento,
      actorUserId,
      actorPapel,
      ip,
      JSON.stringify(payload),
    ]
  )
}

export async function cabinesRoutes(app) {
  /**
   * Gera boleto de royalties no Asaas ao encerrar live.
   * Fire-and-forget: falha silenciosa — a live já está encerrada,
   * o erro fica registrado em boletos.asaas_error para reprocessamento.
   */
  async function gerarBoletoRoyaltiesAsaas({ tenantId, liveId, clienteId, valor }) {
    const idempotencyKey = gerarIdempotencyKey(tenantId, liveId, 'royalties')

    // Idempotência: já existe boleto para esta live?
    const { rows: existing } = await app.db.query(
      `SELECT id FROM boletos WHERE idempotency_key = $1`,
      [idempotencyKey]
    )
    if (existing.length > 0) return

    // Sem valor → não gerar boleto
    if (valor <= 0) return

    // Vencimento: 7 dias
    const vencimento = new Date()
    vencimento.setDate(vencimento.getDate() + 7)
    const vencimentoStr = vencimento.toISOString().split('T')[0]

    // Inserir boleto pendente (persiste mesmo se Asaas falhar)
    const { rows: [boleto] } = await app.db.query(
      `INSERT INTO boletos
         (tenant_id, tipo, valor, vencimento, status,
          idempotency_key, live_id, gerado_automaticamente, competencia)
       VALUES ($1, 'royalties', $2, $3, 'pendente', $4, $5, true, DATE_TRUNC('month', NOW()))
       RETURNING id`,
      [tenantId, valor, vencimentoStr, idempotencyKey, liveId]
    )

    // Buscar dados do cliente para o Asaas
    const { rows: [cliente] } = await app.db.query(
      `SELECT nome, cpf, cnpj, email, celular, asaas_customer_id
       FROM clientes WHERE id = $1`,
      [clienteId]
    )

    if (!cliente) return

    try {
      let asaasCustomerId = cliente.asaas_customer_id
      if (!asaasCustomerId) {
        asaasCustomerId = await buscarOuCriarCustomer({
          nome: cliente.nome,
          cpfCnpj: cliente.cpf || cliente.cnpj,
          email: cliente.email,
          celular: cliente.celular,
        })
        await app.db.query(
          `UPDATE clientes SET asaas_customer_id = $1 WHERE id = $2`,
          [asaasCustomerId, clienteId]
        )
      }

      const payment = await criarCobranca({
        asaasCustomerId,
        valor,
        vencimento: vencimentoStr,
        descricao: `Royalties Live ${liveId.slice(0, 8)} – ${new Date().toLocaleDateString('pt-BR')}`,
        externalReference: boleto.id,
        billingType: 'BOLETO',
      })

      await app.db.query(
        `UPDATE boletos
         SET asaas_id = $1, asaas_url = $2, asaas_pix_copia_cola = $3
         WHERE id = $4`,
        [payment.id, payment.invoiceUrl, payment.pixCopiaECola ?? null, boleto.id]
      )
    } catch (err) {
      await app.db.query(
        `UPDATE boletos SET asaas_error = $1 WHERE id = $2`,
        [err.message, boleto.id]
      )
      app.log.error({ err, liveId }, 'Falha ao criar cobrança Asaas')
    }
  }

  // GET /v1/cabines
  app.get('/v1/cabines', { preHandler: cabineRoleAccess(app) }, async (request) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)

    try {
      const result = await db.query(
        `SELECT c.id, c.numero, c.status, c.live_atual_id, c.contrato_id,
                COALESCE(l.cliente_id, ct.cliente_id) AS cliente_id,
                u.nome AS apresentador_nome,
                cl.nome AS cliente_nome,
                l.iniciado_em,
                COALESCE(ls.viewer_count, 0) AS viewer_count,
                COALESCE(ls.gmv, 0) AS gmv_atual
         FROM cabines c
         LEFT JOIN contratos ct ON ct.id = c.contrato_id
         LEFT JOIN lives l ON l.id = c.live_atual_id
         LEFT JOIN users u ON u.id = l.apresentador_id
         LEFT JOIN clientes cl ON cl.id = COALESCE(l.cliente_id, ct.cliente_id)
         LEFT JOIN LATERAL (
           SELECT viewer_count, gmv
           FROM live_snapshots
           WHERE live_id = c.live_atual_id
           ORDER BY captured_at DESC
           LIMIT 1
         ) ls ON true
         ORDER BY c.numero`
      )

      return result.rows
    } finally {
      db.release()
    }
  })

  // GET /v1/cabines/fila-ativacao
  app.get('/v1/cabines/fila-ativacao', { preHandler: cabineRoleAccess(app) }, async (request) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)

    try {
      const result = await db.query(
        `SELECT ct.id,
                ct.cliente_id,
                cl.nome AS cliente_nome,
                cl.cidade,
                cl.estado,
                ct.valor_fixo,
                ct.comissao_pct,
                ct.ativado_em,
                ct.criado_em
         FROM contratos ct
         JOIN clientes cl ON cl.id = ct.cliente_id
         WHERE ct.status = 'ativo'
           AND NOT EXISTS (
             SELECT 1
             FROM cabines cb
             WHERE cb.contrato_id = ct.id
           )
         ORDER BY ct.ativado_em DESC NULLS LAST, ct.criado_em DESC`
      )

      return result.rows
    } finally {
      db.release()
    }
  })

  // PATCH /v1/cabines/:id/reservar
  app.patch('/v1/cabines/:id/reservar', { preHandler: cabineRoleAccess(app) }, async (request, reply) => {
    const parsed = reservarCabineSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.errors[0].message })

    const { tenant_id, sub, papel } = request.user
    const { contrato_id } = parsed.data
    const ip = getRequestIp(request)
    const db = await app.dbTenant(tenant_id)

    try {
      await db.query('BEGIN')

      try {
        const cabineQ = await db.query(
          `SELECT id, numero, status, contrato_id, live_atual_id
           FROM cabines
           WHERE id = $1
           FOR UPDATE`,
          [request.params.id]
        )
        const cabine = cabineQ.rows[0]

        if (!cabine) {
          await db.query('ROLLBACK')
          return reply.code(404).send({ error: 'Cabine não encontrada' })
        }

        if (cabine.status === 'manutencao') {
          await db.query('ROLLBACK')
          return reply.code(409).send({ error: 'Cabine em manutenção não pode ser reservada' })
        }

        if (cabine.status !== 'disponivel' || cabine.contrato_id || cabine.live_atual_id) {
          await db.query('ROLLBACK')
          return reply.code(409).send({ error: 'Cabine não está disponível para reserva' })
        }

        const contratoQ = await db.query(
          `SELECT id, cliente_id, status
           FROM contratos
           WHERE id = $1
           FOR UPDATE`,
          [contrato_id]
        )
        const contrato = contratoQ.rows[0]

        if (!contrato) {
          await db.query('ROLLBACK')
          return reply.code(404).send({ error: 'Contrato não encontrado para este tenant' })
        }

        if (contrato.status !== 'ativo') {
          await db.query('ROLLBACK')
          return reply.code(409).send({ error: 'Apenas contratos ativos podem reservar cabines' })
        }

        const vinculoExistenteQ = await db.query(
          `SELECT id, numero
           FROM cabines
           WHERE contrato_id = $1
           LIMIT 1`,
          [contrato_id]
        )

        if (vinculoExistenteQ.rows[0]) {
          await db.query('ROLLBACK')
          return reply.code(409).send({ error: 'Contrato já está vinculado a outra cabine' })
        }

        const result = await db.query(
          `UPDATE cabines
           SET status = 'reservada', contrato_id = $1, live_atual_id = NULL
           WHERE id = $2
           RETURNING id, numero, status, contrato_id`,
          [contrato_id, request.params.id]
        )

        await logCabineEvent(db, {
          tenantId: tenant_id,
          cabineId: request.params.id,
          contratoId: contrato_id,
          tipoEvento: 'cabine_reservada',
          actorUserId: sub,
          actorPapel: papel,
          ip,
          payload: { cliente_id: contrato.cliente_id },
        })

        await db.query('COMMIT')
        return result.rows[0]
      } catch (error) {
        await db.query('ROLLBACK')
        throw error
      }
    } finally {
      db.release()
    }
  })

  // PATCH /v1/cabines/:id/liberar
  app.patch('/v1/cabines/:id/liberar', { preHandler: cabineRoleAccess(app) }, async (request, reply) => {
    const { tenant_id, sub, papel } = request.user
    const ip = getRequestIp(request)
    const db = await app.dbTenant(tenant_id)

    try {
      await db.query('BEGIN')

      try {
        const cabineQ = await db.query(
          `SELECT id, numero, status, contrato_id, live_atual_id
           FROM cabines
           WHERE id = $1
           FOR UPDATE`,
          [request.params.id]
        )
        const cabine = cabineQ.rows[0]

        if (!cabine) {
          await db.query('ROLLBACK')
          return reply.code(404).send({ error: 'Cabine não encontrada' })
        }

        if (cabine.status === 'ao_vivo' || cabine.live_atual_id) {
          await db.query('ROLLBACK')
          return reply.code(409).send({ error: 'Encerre a live antes de liberar a cabine' })
        }

        const result = await db.query(
          `UPDATE cabines
           SET status = 'disponivel', contrato_id = NULL, live_atual_id = NULL
           WHERE id = $1
           RETURNING id, numero, status, contrato_id`,
          [request.params.id]
        )

        if (cabine.contrato_id || cabine.status !== 'disponivel') {
          await logCabineEvent(db, {
            tenantId: tenant_id,
            cabineId: request.params.id,
            contratoId: cabine.contrato_id,
            tipoEvento: 'cabine_liberada',
            actorUserId: sub,
            actorPapel: papel,
            ip,
            payload: { previous_status: cabine.status },
          })
        }

        await db.query('COMMIT')
        return result.rows[0]
      } catch (error) {
        await db.query('ROLLBACK')
        throw error
      }
    } finally {
      db.release()
    }
  })

  // GET /v1/cabines/:id/historico?dias=90
  app.get('/v1/cabines/:id/historico', { preHandler: cabineRoleAccess(app) }, async (request, reply) => {
    const { tenant_id } = request.user
    const cabineId = request.params.id
    const dias = parseInt(request.query.dias) || 90

    const db = await app.dbTenant(tenant_id)
    try {
      const cabineResult = await db.query(`SELECT id FROM cabines WHERE id = $1`, [cabineId])
      if (cabineResult.rowCount === 0) {
        return reply.code(404).send({ error: 'Cabine não encontrada' })
      }

      const topClientesQ = await db.query(`
        SELECT cl.nome, SUM(l.fat_gerado) as fat_total, COUNT(l.id) as total_lives
        FROM lives l
        JOIN clientes cl ON cl.id = l.cliente_id
        WHERE l.cabine_id = $1
          AND l.status = 'encerrada'
          AND l.iniciado_em > NOW() - INTERVAL '${dias} days'
        GROUP BY cl.id, cl.nome
        ORDER BY fat_total DESC
        LIMIT 5
      `, [cabineId])

      const melhoresHorariosQ = await db.query(`
        SELECT
          EXTRACT(HOUR FROM iniciado_em) AS hora,
          COUNT(*) AS total_lives,
          AVG(fat_gerado) AS gmv_medio,
          SUM(fat_gerado) AS gmv_total
        FROM lives
        WHERE cabine_id = $1
          AND status = 'encerrada'
          AND iniciado_em > NOW() - INTERVAL '${dias} days'
        GROUP BY hora
        ORDER BY gmv_medio DESC
      `, [cabineId])

      const desempenhoMensalQ = await db.query(`
        SELECT
          EXTRACT(MONTH FROM iniciado_em) as mes,
          EXTRACT(YEAR FROM iniciado_em) as ano,
          SUM(fat_gerado) as fat_total,
          COUNT(id) as total_lives
        FROM lives
        WHERE cabine_id = $1 AND status = 'encerrada'
        GROUP BY ano, mes
        ORDER BY ano DESC, mes DESC
        LIMIT 6
      `, [cabineId])

      const desempenho = desempenhoMensalQ.rows
      let crescimento_pct = 0

      if (desempenho.length >= 2) {
        const atual = parseFloat(desempenho[0].fat_total)
        const anterior = parseFloat(desempenho[1].fat_total)
        if (anterior > 0) {
          crescimento_pct = ((atual - anterior) / anterior) * 100
        }
      }

      const totaisQ = await db.query(`
        SELECT COUNT(id) as total_lives, SUM(fat_gerado) as gmv_total
        FROM lives WHERE cabine_id = $1 AND status = 'encerrada'
      `, [cabineId])

      return {
        top_clientes: topClientesQ.rows.map((r) => ({
          nome: r.nome,
          fat_total: parseFloat(r.fat_total),
          total_lives: parseInt(r.total_lives),
        })),
        melhores_horarios: melhoresHorariosQ.rows.map((r) => ({
          hora: `${String(r.hora).padStart(2, '0')}h - ${String(parseInt(r.hora) + 2).padStart(2, '0')}h`,
          total_lives: parseInt(r.total_lives),
          gmv_medio: parseFloat(r.gmv_medio),
          gmv_total: parseFloat(r.gmv_total),
        })),
        desempenho_mensal: {
          meses: desempenho.map((r) => ({
            mes: `${r.mes}/${r.ano}`,
            fat_total: parseFloat(r.fat_total),
            total_lives: parseInt(r.total_lives),
          })),
          crescimento_pct: parseFloat(crescimento_pct.toFixed(1)),
        },
        totais: {
          total_lives: parseInt(totaisQ.rows[0].total_lives || 0),
          gmv_total: parseFloat(totaisQ.rows[0].gmv_total || 0),
        },
      }
    } finally {
      db.release()
    }
  })

  // GET /v1/cabines/:id/live-atual
  app.get('/v1/cabines/:id/live-atual', { preHandler: cabineRoleAccess(app) }, async (request, reply) => {
    const { tenant_id } = request.user
    const cabineId = request.params.id

    const db = await app.dbTenant(tenant_id)
    try {
      const cabineQ = await db.query(`SELECT live_atual_id, status FROM cabines WHERE id = $1`, [cabineId])
      const cabine = cabineQ.rows[0]

      if (!cabine) return reply.code(404).send({ error: 'Cabine não encontrada' })
      if (cabine.status !== 'ao_vivo' || !cabine.live_atual_id) {
        return reply.code(400).send({ error: 'Cabine não está ao vivo no momento' })
      }

      const liveId = cabine.live_atual_id

      const liveQ = await db.query(`
        SELECT l.iniciado_em, l.fat_gerado,
               u.nome AS apresentador_nome,
               cl.nome AS cliente_nome
        FROM lives l
        JOIN users u ON u.id = l.apresentador_id
        JOIN clientes cl ON cl.id = l.cliente_id
        WHERE l.id = $1
      `, [liveId])
      const liveData = liveQ.rows[0]

      const snapshotQ = await db.query(`
        SELECT viewer_count, total_orders, gmv, captured_at
        FROM live_snapshots
        WHERE live_id = $1
        ORDER BY captured_at DESC LIMIT 1
      `, [liveId])
      const snapshot = snapshotQ.rows[0] || { viewer_count: 0, total_orders: 0, gmv: 0 }

      const topProdutoQ = await db.query(`
        SELECT produto_nome, quantidade, valor_total
        FROM live_products
        WHERE live_id = $1
        ORDER BY quantidade DESC LIMIT 1
      `, [liveId])
      const topProduto = topProdutoQ.rows[0]

      const iniciadoEm = new Date(liveData.iniciado_em)
      const agora = new Date()
      const duracaoMinutos = Math.floor((agora - iniciadoEm) / 1000 / 60)

      return {
        viewer_count: snapshot.viewer_count,
        gmv_atual: parseFloat(snapshot.gmv),
        total_orders: snapshot.total_orders,
        duracao_minutos: duracaoMinutos,
        cliente_nome: liveData.cliente_nome,
        apresentador_nome: liveData.apresentador_nome,
        iniciado_em: liveData.iniciado_em,
        top_produto: topProduto ? {
          nome: topProduto.produto_nome,
          quantidade: topProduto.quantidade,
          valor_total: parseFloat(topProduto.valor_total),
        } : null,
      }
    } finally {
      db.release()
    }
  })

  // PATCH /v1/cabines/:id/status
  app.patch('/v1/cabines/:id/status', { preHandler: cabineRoleAccess(app) }, async (request, reply) => {
    const parsed = atualizarStatusSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.errors[0].message })

    const { tenant_id, sub, papel } = request.user
    const { status } = parsed.data
    const ip = getRequestIp(request)
    const db = await app.dbTenant(tenant_id)

    try {
      await db.query('BEGIN')

      try {
        const cabineQ = await db.query(
          `SELECT id, numero, status, contrato_id, live_atual_id
           FROM cabines
           WHERE id = $1
           FOR UPDATE`,
          [request.params.id]
        )
        const cabine = cabineQ.rows[0]

        if (!cabine) {
          await db.query('ROLLBACK')
          return reply.code(404).send({ error: 'Cabine não encontrada' })
        }

        if (cabine.live_atual_id || cabine.status === 'ao_vivo') {
          await db.query('ROLLBACK')
          return reply.code(409).send({ error: 'Cabine ao vivo não pode ter o status alterado manualmente' })
        }

        if (status === 'disponivel' && cabine.contrato_id) {
          await db.query('ROLLBACK')
          return reply.code(409).send({ error: 'Use liberar para remover o vínculo contratual da cabine' })
        }

        if (status === 'manutencao' && cabine.contrato_id) {
          await db.query('ROLLBACK')
          return reply.code(409).send({ error: 'Libere a cabine antes de colocá-la em manutenção' })
        }

        if (status === 'ativa' && !cabine.contrato_id) {
          await db.query('ROLLBACK')
          return reply.code(409).send({ error: 'Cabine sem contrato não pode ser marcada como ativa' })
        }

        const result = await db.query(
          `UPDATE cabines SET status = $1 WHERE id = $2 RETURNING id, numero, status, contrato_id`,
          [status, request.params.id]
        )

        if (status !== cabine.status) {
          await logCabineEvent(db, {
            tenantId: tenant_id,
            cabineId: request.params.id,
            contratoId: cabine.contrato_id,
            tipoEvento: status === 'manutencao'
              ? 'cabine_manutencao'
              : status === 'ativa'
                ? 'cabine_ativada'
                : 'cabine_liberada',
            actorUserId: sub,
            actorPapel: papel,
            ip,
            payload: { previous_status: cabine.status, next_status: status },
          })
        }

        await db.query('COMMIT')
        return result.rows[0]
      } catch (error) {
        await db.query('ROLLBACK')
        throw error
      }
    } finally {
      db.release()
    }
  })

  // POST /v1/lives — inicia live a partir da cabine reservada/ativa
  app.post('/v1/lives', { preHandler: cabineRoleAccess(app) }, async (request, reply) => {
    const parsed = iniciarLiveSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.errors[0].message })

    const { tenant_id, sub, papel } = request.user
    const { cabine_id } = parsed.data
    const ip = getRequestIp(request)
    const db = await app.dbTenant(tenant_id)

    try {
      await db.query('BEGIN')

      try {
        const cabineQ = await db.query(
          `SELECT id, numero, status, contrato_id, live_atual_id
           FROM cabines
           WHERE id = $1
           FOR UPDATE`,
          [cabine_id]
        )
        const cabine = cabineQ.rows[0]

        if (!cabine) {
          await db.query('ROLLBACK')
          return reply.code(404).send({ error: 'Cabine não encontrada' })
        }

        if (!['reservada', 'ativa'].includes(cabine.status) || !cabine.contrato_id) {
          await db.query('ROLLBACK')
          return reply.code(409).send({ error: 'Cabine precisa estar reservada ou ativa para iniciar a live' })
        }

        if (cabine.live_atual_id) {
          await db.query('ROLLBACK')
          return reply.code(409).send({ error: 'Cabine já possui uma live em andamento' })
        }

        const contratoQ = await db.query(
          `SELECT id, cliente_id, status
           FROM contratos
           WHERE id = $1
           FOR UPDATE`,
          [cabine.contrato_id]
        )
        const contrato = contratoQ.rows[0]

        if (!contrato || contrato.status !== 'ativo') {
          await db.query('ROLLBACK')
          return reply.code(409).send({ error: 'Contrato vinculado não está apto para iniciar live' })
        }

        const liveQ = await db.query(
          `INSERT INTO lives (tenant_id, cabine_id, cliente_id, apresentador_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id, iniciado_em, cliente_id, apresentador_id`,
          [tenant_id, cabine_id, contrato.cliente_id, sub]
        )
        const live = liveQ.rows[0]

        await db.query(
          `UPDATE cabines
           SET status = 'ao_vivo', live_atual_id = $1
           WHERE id = $2`,
          [live.id, cabine_id]
        )

        await logCabineEvent(db, {
          tenantId: tenant_id,
          cabineId: cabine_id,
          contratoId: cabine.contrato_id,
          tipoEvento: 'cabine_live_iniciada',
          actorUserId: sub,
          actorPapel: papel,
          ip,
          payload: {
            live_id: live.id,
            cliente_id: contrato.cliente_id,
            previous_status: cabine.status,
          },
        })

        await db.query('COMMIT')
        return reply.code(201).send(live)
      } catch (error) {
        await db.query('ROLLBACK')
        throw error
      }
    } finally {
      db.release()
    }
  })

  // GET /v1/lives
  app.get('/v1/lives', { preHandler: cabineRoleAccess(app) }, async (request) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)
    try {
      const result = await db.query(
        `SELECT l.*, c.numero AS cabine_numero, c.contrato_id, cl.nome AS cliente_nome,
                u.nome AS apresentador_nome
         FROM lives l
         JOIN cabines c ON c.id = l.cabine_id
         JOIN clientes cl ON cl.id = l.cliente_id
         JOIN users u ON u.id = l.apresentador_id
         ORDER BY l.iniciado_em DESC LIMIT 100`
      )
      return result.rows
    } finally {
      db.release()
    }
  })

  // PATCH /v1/lives/:id/encerrar
  app.patch('/v1/lives/:id/encerrar', { preHandler: cabineRoleAccess(app) }, async (request, reply) => {
    const parsed = encerrarSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.errors[0].message })

    const { tenant_id, sub, papel } = request.user
    const ip = getRequestIp(request)
    const db = await app.dbTenant(tenant_id)

    try {
      await db.query('BEGIN')

      try {
        const liveQ = await db.query(
          `SELECT id, cabine_id, cliente_id, status
           FROM lives
           WHERE id = $1 AND status = 'em_andamento'
           FOR UPDATE`,
          [request.params.id]
        )
        const live = liveQ.rows[0]

        if (!live) {
          await db.query('ROLLBACK')
          return reply.code(400).send({ error: 'Live não encontrada ou já encerrada' })
        }

        const cabineQ = await db.query(
          `SELECT id, contrato_id, status
           FROM cabines
           WHERE id = $1
           FOR UPDATE`,
          [live.cabine_id]
        )
        const cabine = cabineQ.rows[0]

        const contratoQ = cabine?.contrato_id
          ? await db.query(
              `SELECT id, status, comissao_pct
               FROM contratos
               WHERE id = $1
               FOR UPDATE`,
              [cabine.contrato_id]
            )
          : { rows: [] }
        const contrato = contratoQ.rows[0]

        const comissaoPct = Number(contrato?.comissao_pct ?? 0)
        const comissao = parsed.data.fat_gerado * (comissaoPct / 100)

        await db.query(
          `UPDATE lives
           SET status = 'encerrada', encerrado_em = NOW(),
               fat_gerado = $1, comissao_calculada = $2
           WHERE id = $3`,
          [parsed.data.fat_gerado, comissao, request.params.id]
        )

        const proximoStatus = contrato?.status === 'ativo' ? 'ativa' : 'disponivel'
        const proximoContratoId = contrato?.status === 'ativo' ? contrato.id : null

        await db.query(
          `UPDATE cabines
           SET status = $1,
               live_atual_id = NULL,
               contrato_id = $2
           WHERE id = $3`,
          [proximoStatus, proximoContratoId, live.cabine_id]
        )

        await logCabineEvent(db, {
          tenantId: tenant_id,
          cabineId: live.cabine_id,
          contratoId: cabine?.contrato_id ?? null,
          tipoEvento: 'cabine_live_encerrada',
          actorUserId: sub,
          actorPapel: papel,
          ip,
          payload: {
            live_id: live.id,
            fat_gerado: parsed.data.fat_gerado,
            comissao_calculada: comissao,
            next_status: proximoStatus,
          },
        })

        await db.query('COMMIT')

        // Gerar cobrança automática de royalties (fire-and-forget)
        if (comissao > 0) {
          gerarBoletoRoyaltiesAsaas({
            tenantId: tenant_id,
            liveId: live.id,
            clienteId: live.cliente_id,
            valor: comissao,
          }).catch(err => app.log.error({ err }, 'gerarBoletoRoyaltiesAsaas: erro inesperado'))
        }

        return { ok: true, fat_gerado: parsed.data.fat_gerado, comissao_calculada: comissao }
      } catch (error) {
        await db.query('ROLLBACK')
        throw error
      }
    } finally {
      db.release()
    }
  })
}
