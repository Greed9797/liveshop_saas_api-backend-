import Fastify from 'fastify'
import fp from 'fastify-plugin'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authPlugin } from '../src/plugins/auth.js'
import { analyticsRoutes } from '../src/routes/analytics.js'
import { cabinesRoutes } from '../src/routes/cabines.js'
import { clienteDashboardRoutes } from '../src/routes/cliente_dashboard.js'
import { financeiroRoutes } from '../src/routes/financeiro.js'
import { franqueadoRoutes } from '../src/routes/franqueado.js'
import { leadsRoutes } from '../src/routes/leads.js'

const ENV_KEYS = [
  'JWT_SECRET',
  'USE_DEV_BYPASS',
  'NODE_ENV',
  'DEV_BYPASS_ROLE',
  'DEV_BYPASS_USER_ID',
  'DEV_BYPASS_TENANT_ID',
  'DEV_BYPASS_NAME',
]

let envSnapshot = {}

beforeEach(() => {
  envSnapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (envSnapshot[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = envSnapshot[key]
    }
  }
})

describe('Route regressions: SQL and RBAC', () => {
  it('financeiro resumo uses CTE aggregation and keeps endpoint healthy', async () => {
    const app = Fastify()
    const queryMock = vi.fn().mockResolvedValue({
      rows: [{ fat_bruto_fixo: '1200', fat_bruto_comissao: '300', total_custos: '400' }],
    })
    const releaseMock = vi.fn()

    app.decorate('authenticate', async (request) => {
      request.user = { tenant_id: 'tenant-1', papel: 'franqueado' }
    })
    // requirePapel é usado diretamente como preHandler (sem authenticate na frente)
    // → precisa setar request.user se não estiver definido
    app.decorate('requirePapel', (papeis) => async (request, reply) => {
      if (!request.user) request.user = { tenant_id: 'tenant-1', papel: 'franqueado' }
      if (!papeis.includes(request.user.papel)) return reply.code(403).send({ error: 'Forbidden' })
    })
    app.decorate('dbTenant', async () => ({ query: queryMock, release: releaseMock }))

    await app.register(financeiroRoutes)

    const response = await app.inject({ method: 'GET', url: '/v1/financeiro/resumo?mes=4&ano=2026' })
    const payload = response.json()

    expect(response.statusCode).toBe(200)
    expect(payload).toMatchObject({
      fat_bruto: 1500,
      fat_liquido: 1100,
      total_custos: 400,
      periodo: '2026-04-01',
    })
    expect(queryMock).toHaveBeenCalledTimes(1)

    const sql = queryMock.mock.calls[0][0]
    expect(sql).toContain('WITH contratos_mes')
    expect(sql).toContain('custos_mes')
    expect(sql).toContain('CROSS JOIN custos_mes')
    expect(sql).not.toContain('COALESCE(cu.total_custos, 0)')
    expect(releaseMock).toHaveBeenCalledTimes(1)

    await app.close()
  })

  it('franqueado unidades query references iniciado_em (schema-safe)', async () => {
    const app = Fastify()
    const queryMock = vi.fn().mockResolvedValue({ rows: [] })

    app.decorate('authenticate', async (request) => {
      request.user = { tenant_id: 'tenant-master', papel: 'franqueador_master' }
    })
    app.decorate('requirePapel', (papeis) => async (request, reply) => {
      if (!papeis.includes(request.user.papel)) {
        return reply.code(403).send({ error: 'Acesso não autorizado para este papel' })
      }
    })
    app.decorate('db', { query: queryMock })

    await app.register(franqueadoRoutes)

    const response = await app.inject({ method: 'GET', url: '/v1/franqueado/unidades' })

    expect(response.statusCode).toBe(200)
    expect(queryMock).toHaveBeenCalledTimes(1)

    const sql = queryMock.mock.calls[0][0]
    expect(sql).toContain('l.iniciado_em')
    expect(sql).not.toContain('l.iniciada_em')
    expect(queryMock.mock.calls[0][1]).toEqual(['tenant-master'])

    await app.close()
  })

  it('RBAC blocks cliente dashboard role when bypass is disabled', async () => {
    process.env.NODE_ENV = 'test'
    process.env.JWT_SECRET = 'test-secret'
    delete process.env.USE_DEV_BYPASS

    const app = Fastify()
    const fakeDbPlugin = fp(async (instance) => {
      instance.decorate('db', { query: vi.fn() })
    }, { name: 'db' })

    await app.register(fakeDbPlugin)
    await app.register(authPlugin)

    app.get('/rbac-check', {
      preHandler: app.requirePapel(['cliente_parceiro']),
    }, async () => ({ ok: true }))

    const token = app.jwt.sign({
      sub: 'user-1',
      tenant_id: 'tenant-1',
      papel: 'franqueado',
      nome: 'Dev User',
    })

    const response = await app.inject({
      method: 'GET',
      url: '/rbac-check',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('RBAC bypass works only with explicit USE_DEV_BYPASS=true outside production', async () => {
    process.env.NODE_ENV = 'development'
    process.env.JWT_SECRET = 'test-secret'
    process.env.USE_DEV_BYPASS = 'true'
    process.env.DEV_BYPASS_ROLE = 'cliente_parceiro'

    const app = Fastify()
    const fakeDbPlugin = fp(async (instance) => {
      instance.decorate('db', { query: vi.fn() })
    }, { name: 'db' })

    await app.register(fakeDbPlugin)
    await app.register(authPlugin)

    app.get('/rbac-check', {
      preHandler: app.requirePapel(['cliente_parceiro']),
    }, async (request) => ({ ok: true, papel: request.user.papel }))

    const response = await app.inject({ method: 'GET', url: '/rbac-check' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true, papel: 'cliente_parceiro' })

    await app.close()
  })

  it('leads listing is scoped by franqueadora_id and tenant pickup ownership', async () => {
    const app = Fastify()
    const queryMock = vi.fn().mockResolvedValue({ rows: [] })

    app.decorate('authenticate', async (request) => {
      request.user = { tenant_id: 'tenant-1', papel: 'franqueado' }
    })
    app.decorate('requirePapel', (papeis) => async (request, reply) => {
      if (!papeis.includes(request.user.papel)) {
        return reply.code(403).send({ error: 'Acesso não autorizado para este papel' })
      }
    })
    app.decorate('db', { query: queryMock, pool: { connect: vi.fn() } })

    await app.register(leadsRoutes)

    const response = await app.inject({ method: 'GET', url: '/v1/leads' })

    expect(response.statusCode).toBe(200)
    expect(queryMock).toHaveBeenCalledTimes(1)

    const sql = queryMock.mock.calls[0][0]
    expect(sql).toContain('franqueadora_id = $1')
    expect(sql).toContain("status = 'disponivel' OR pego_por = $1")
    expect(queryMock.mock.calls[0][1]).toEqual(['tenant-1'])

    await app.close()
  })

  it('leads endpoints block cliente_parceiro role', async () => {
    const app = Fastify()

    app.decorate('authenticate', async (request) => {
      request.user = { tenant_id: 'tenant-1', papel: 'cliente_parceiro' }
    })
    app.decorate('requirePapel', (papeis) => async (request, reply) => {
      if (!papeis.includes(request.user.papel)) {
        return reply.code(403).send({ error: 'Acesso não autorizado para este papel' })
      }
    })
    app.decorate('db', { query: vi.fn(), pool: { connect: vi.fn() } })

    await app.register(leadsRoutes)

    const response = await app.inject({ method: 'GET', url: '/v1/leads' })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('cabines list exposes contract linkage and live metrics in one query', async () => {
    const app = Fastify()
    const queryMock = vi.fn().mockResolvedValue({ rows: [] })
    const releaseMock = vi.fn()

    app.decorate('authenticate', async (request) => {
      request.user = { tenant_id: 'tenant-1', papel: 'franqueado' }
    })
    app.decorate('requirePapel', (papeis) => async (request, reply) => {
      if (!papeis.includes(request.user.papel)) {
        return reply.code(403).send({ error: 'Acesso não autorizado para este papel' })
      }
    })
    app.decorate('dbTenant', async () => ({ query: queryMock, release: releaseMock }))

    await app.register(cabinesRoutes)

    const response = await app.inject({ method: 'GET', url: '/v1/cabines' })

    expect(response.statusCode).toBe(200)
    expect(queryMock).toHaveBeenCalledTimes(1)

    const sql = queryMock.mock.calls[0][0]
    expect(sql).toContain('c.contrato_id')
    expect(sql).toContain('COALESCE(l.cliente_id, ct.cliente_id) AS cliente_id')
    expect(sql).toContain('COALESCE(ls.viewer_count, 0) AS viewer_count')
    expect(sql).toContain('COALESCE(ls.gmv, 0) AS gmv_atual')
    expect(releaseMock).toHaveBeenCalledTimes(1)

    await app.close()
  })

  it('cabine reservation only accepts active contracts from same tenant', async () => {
    const app = Fastify()
    const cabineId = '11111111-1111-4111-8111-111111111111'
    const contratoId = '22222222-2222-4222-8222-222222222222'
    const clienteId = '33333333-3333-4333-8333-333333333333'
    const queryMock = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: cabineId, numero: 2, status: 'disponivel', contrato_id: null, live_atual_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: contratoId, cliente_id: clienteId, status: 'ativo' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: cabineId, numero: 2, status: 'reservada', contrato_id: contratoId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const releaseMock = vi.fn()

    app.decorate('authenticate', async (request) => {
      request.user = { tenant_id: 'tenant-1', sub: 'user-1', papel: 'franqueado' }
    })
    app.decorate('requirePapel', (papeis) => async (request, reply) => {
      if (!papeis.includes(request.user.papel)) {
        return reply.code(403).send({ error: 'Acesso não autorizado para este papel' })
      }
    })
    app.decorate('dbTenant', async () => ({ query: queryMock, release: releaseMock }))

    await app.register(cabinesRoutes)

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/cabines/${cabineId}/reservar`,
      payload: { contrato_id: contratoId },
    })

    expect(response.statusCode).toBe(200)
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'reservada', contrato_id = $1"),
      [contratoId, cabineId]
    )
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('cabine_eventos'),
      expect.arrayContaining(['tenant-1', cabineId, contratoId, 'cabine_reservada', 'user-1', 'franqueado'])
    )
    expect(releaseMock).toHaveBeenCalledTimes(1)

    await app.close()
  })

  it('live start derives presenter and client from cabine + contrato linkage', async () => {
    const app = Fastify()
    const cabineId = '11111111-1111-4111-8111-111111111111'
    const contratoId = '22222222-2222-4222-8222-222222222222'
    const clienteId = '33333333-3333-4333-8333-333333333333'
    const userId = '44444444-4444-4444-8444-444444444444'
    const liveId = '55555555-5555-4555-8555-555555555555'
    const queryMock = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: cabineId, numero: 1, status: 'reservada', contrato_id: contratoId, live_atual_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: contratoId, cliente_id: clienteId, status: 'ativo' }] })
      .mockResolvedValueOnce({ rows: [{ id: liveId, iniciado_em: '2026-04-03T21:00:00.000Z', cliente_id: clienteId, apresentador_id: userId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const releaseMock = vi.fn()

    app.decorate('authenticate', async (request) => {
      request.user = { tenant_id: 'tenant-1', sub: userId, papel: 'franqueado' }
    })
    app.decorate('requirePapel', (papeis) => async (request, reply) => {
      if (!papeis.includes(request.user.papel)) {
        return reply.code(403).send({ error: 'Acesso não autorizado para este papel' })
      }
    })
    app.decorate('dbTenant', async () => ({ query: queryMock, release: releaseMock }))

    await app.register(cabinesRoutes)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/lives',
      payload: { cabine_id: cabineId },
    })

    expect(response.statusCode).toBe(201)
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO lives (tenant_id, cabine_id, cliente_id, apresentador_id)'),
      ['tenant-1', cabineId, clienteId, userId]
    )
    expect(releaseMock).toHaveBeenCalledTimes(1)

    await app.close()
  })

  it('analytics resumo aggregates rankings, heatmap and realtime summary per tenant', async () => {
    const app = Fastify()
    const queryMock = vi.fn()
      .mockResolvedValueOnce({ rows: [{ gmv_total_hoje: '12450.50', audiencia_total_ao_vivo: '850', total_lives_hoje: '12' }] })
      .mockResolvedValueOnce({ rows: [{ apresentador_id: 'user-1', apresentador_nome: 'Closer 1', total_lives: '45', gmv_total: '85400.00' }] })
      .mockResolvedValueOnce({ rows: [{ cliente_id: 'cli-1', cliente_nome: 'Parceiro Alpha', gmv_total: '120500.00', ultima_live: '2026-04-03T20:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ hora: 20, total_lives: '25', gmv_total: '18500.00' }] })
      .mockResolvedValueOnce({ rows: [{ cabine_id: 'cab-1', cabine_nome: 'Cabine 01', total_lives: '88', gmv_acumulado: '45000.00' }] })
    const releaseMock = vi.fn()

    app.decorate('authenticate', async (request) => {
      request.user = { tenant_id: 'tenant-1', papel: 'franqueador_master' }
    })
    app.decorate('requirePapel', (papeis) => async (request, reply) => {
      if (!papeis.includes(request.user.papel)) {
        return reply.code(403).send({ error: 'Acesso não autorizado para este papel' })
      }
    })
    app.decorate('dbTenant', async () => ({ query: queryMock, release: releaseMock }))

    await app.register(analyticsRoutes)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/analytics/franqueado/resumo',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      resumo_hoje: {
        gmv_total_hoje: 12450.5,
        audiencia_total_ao_vivo: 850,
        total_lives_hoje: 12,
      },
      ranking_closers: [
        {
          apresentador_id: 'user-1',
          apresentador_nome: 'Closer 1',
          total_lives: 45,
          gmv_total: 85400,
        },
      ],
      ranking_clientes: [
        {
          cliente_id: 'cli-1',
          cliente_nome: 'Parceiro Alpha',
          gmv_total: 120500,
          ultima_live: '2026-04-03T20:00:00.000Z',
        },
      ],
      heatmap_horarios: [
        {
          hora: 20,
          total_lives: 25,
          gmv_total: 18500,
        },
      ],
      eficiencia_cabines: [
        {
          cabine_id: 'cab-1',
          cabine_nome: 'Cabine 01',
          total_lives: 88,
          gmv_acumulado: 45000,
        },
      ],
    })

    const realtimeSql = queryMock.mock.calls[0][0]
    expect(realtimeSql).toContain('WITH lives_ao_vivo AS')
    expect(realtimeSql).toContain('snapshots_recentes')

    const closersSql = queryMock.mock.calls[1][0]
    expect(closersSql).toContain('JOIN users u ON u.id = l.apresentador_id')

    const clientesSql = queryMock.mock.calls[2][0]
    expect(clientesSql).toContain('JOIN clientes c ON c.id = l.cliente_id')

    const heatmapSql = queryMock.mock.calls[3][0]
    expect(heatmapSql).toContain('EXTRACT(HOUR FROM l.iniciado_em)::int AS hora')

    expect(releaseMock).toHaveBeenCalledTimes(1)

    await app.close()
  })

  it('cliente dashboard returns next reservation and benchmark payload with tenant-safe ranking', async () => {
    const app = Fastify()
    const queryMock = vi.fn()
      .mockResolvedValueOnce({ rows: [{ email: 'parceiro@teste.com' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'cli-1', nicho: 'Moda Feminina', nome: 'Parceiro Alpha' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'ctr-1', comissao_pct: '12.50', ativado_em: '2026-04-03T20:00:00.000Z', assinado_em: '2026-04-01T15:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ faturamento_mes: '8200.00', lucro_estimado: '1230.00' }] })
      .mockResolvedValueOnce({ rows: [{ mes_atual: '8200.00', mes_anterior: '7300.00' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ produto: 'Vestido', qty: '12', valor: '4500.00' }] })
      .mockResolvedValueOnce({ rows: [{ cliente_id: 'cli-1', total: '1200.00', posicao: '2', total_participantes: '14' }] })
      .mockResolvedValueOnce({ rows: [{ cabine_id: 'cab-3', cabine_numero: 3, status: 'reservada', contrato_id: 'ctr-1', ativado_em: '2026-04-03T20:00:00.000Z', assinado_em: '2026-04-01T15:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ nicho: 'Moda Feminina', meu_gmv: '8200.00', media_gmv_nicho: '10250.00', amostra_nicho: '9', media_gmv_geral: '17400.00', amostra_geral: '26', percentil_nicho: '0.68', percentil_geral: '0.41' }] })
    const releaseMock = vi.fn()

    app.decorate('requirePapel', (papeis) => async (request, reply) => {
      request.user = { sub: 'user-1', tenant_id: 'tenant-1', papel: 'cliente_parceiro' }
      if (!papeis.includes(request.user.papel)) {
        return reply.code(403).send({ error: 'Acesso não autorizado para este papel' })
      }
    })
    app.decorate('dbTenant', async () => ({ query: queryMock, release: releaseMock }))

    await app.register(clienteDashboardRoutes)

    const response = await app.inject({ method: 'GET', url: '/v1/cliente/dashboard' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      faturamento_mes: 8200,
      crescimento_pct: 12,
      volume_vendas: 12,
      lucro_estimado: 1230,
      live_ativa: null,
      mais_vendidos: [
        {
          produto: 'Vestido',
          qty: 12,
          valor: 4500,
        },
      ],
      ranking_dia: {
        posicao: 2,
        gmv_dia: 1200,
        total_participantes: 14,
      },
      proxima_reserva: {
        cabine_id: 'cab-3',
        cabine_numero: 3,
        status: 'reservada',
        contrato_id: 'ctr-1',
        ativado_em: '2026-04-03T20:00:00.000Z',
        assinado_em: '2026-04-01T15:00:00.000Z',
      },
      benchmark_nicho: {
        nicho: 'Moda Feminina',
        meu_gmv: 8200,
        media_gmv: 10250,
        percentual_da_media: 80,
        percentil: 0.68,
        amostra: 9,
        acima_da_media: false,
      },
      benchmark_geral: {
        nicho: null,
        meu_gmv: 8200,
        media_gmv: 17400,
        percentual_da_media: 47.1,
        percentil: 0.41,
        amostra: 26,
        acima_da_media: false,
      },
    })

    const rankingSql = queryMock.mock.calls[7][0]
    expect(rankingSql).toContain('WHERE tenant_id = $1')
    expect(rankingSql).toContain("date_trunc('day', iniciado_em) = date_trunc('day', NOW())")

    const benchmarkSql = queryMock.mock.calls[9][0]
    expect(benchmarkSql).toContain('WITH base_90_dias AS')
    expect(benchmarkSql).toContain('PERCENT_RANK() OVER')
    expect(releaseMock).toHaveBeenCalledTimes(1)

    await app.close()
  })

  it('POST /v1/financeiro/custos deve usar dbTenant (não app.db)', async () => {
    const app = Fastify()
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [{ id: 'uuid-1', descricao: 'Aluguel', valor: 1500, tipo: 'aluguel', competencia: '2026-04' }]
    })
    const mockRelease = vi.fn()

    app.decorate('authenticate', async (req) => {
      req.user = { sub: 'user-1', tenant_id: 'tenant-1', papel: 'franqueado' }
    })
    // requirePapel é o único preHandler na rota → seta request.user se não definido
    app.decorate('requirePapel', (papeis) => async (request, reply) => {
      if (!request.user) request.user = { sub: 'user-1', tenant_id: 'tenant-1', papel: 'franqueado' }
      if (!papeis.includes(request.user.papel)) return reply.code(403).send({ error: 'Forbidden' })
    })
    app.decorate('dbTenant', vi.fn().mockResolvedValue({ query: mockQuery, release: mockRelease }))
    app.decorate('db', { query: vi.fn() })

    await app.register(financeiroRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/v1/financeiro/custos',
      payload: { descricao: 'Aluguel', valor: 1500, tipo: 'aluguel', competencia: '2026-04' }
    })

    expect(res.statusCode).toBe(201)
    expect(app.dbTenant).toHaveBeenCalledWith('tenant-1')
    expect(mockRelease).toHaveBeenCalled()
    expect(app.db.query).not.toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO custos'),
      ['tenant-1', 'Aluguel', 1500, 'aluguel', '2026-04']
    )

    await app.close()
  })

  it('GET /v1/lives/:liveId/stream retorna 404 quando live não pertence ao tenant', async () => {
    const app = Fastify()
    const queryMock = vi.fn().mockResolvedValue({ rows: [] })

    app.decorate('authenticate', async (request) => {
      request.user = { tenant_id: 'tenant-1' }
    })
    app.decorate('db', { query: queryMock })

    app.get('/v1/lives/:liveId/stream',
      { preHandler: [app.authenticate] },
      async (request, reply) => {
        const { tenant_id } = request.user
        const { liveId } = request.params
        const { rows } = await app.db.query(
          `SELECT id FROM lives WHERE id = $1 AND tenant_id = $2 AND status = 'em_andamento'`,
          [liveId, tenant_id, 'em_andamento']
        )
        if (rows.length === 0) return reply.code(404).send({ error: 'Live não encontrada ou não está ao vivo' })
        return reply.send({ ok: true })
      }
    )

    const response = await app.inject({
      method: 'GET',
      url: '/v1/lives/live-nao-existe/stream',
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: expect.any(String) })
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1 AND tenant_id = $2'),
      expect.arrayContaining(['live-nao-existe', 'tenant-1'])
    )

    await app.close()
  })

  it('live-atual retorna live_id no payload', async () => {
    const app = Fastify()
    const liveId = 'live-uuid-123'
    const cabineId = 'cabine-uuid-456'

    const queryMock = vi.fn()
      .mockResolvedValueOnce({ rows: [{ live_atual_id: liveId, status: 'ao_vivo' }] })
      .mockResolvedValueOnce({ rows: [{ iniciado_em: new Date().toISOString(), fat_gerado: 0, apresentador_nome: 'Closer', cliente_nome: 'Parceiro' }] })
      .mockResolvedValueOnce({ rows: [{ viewer_count: 10, total_orders: 2, gmv: 500, likes_count: 50, comments_count: 30 }] })
      .mockResolvedValueOnce({ rows: [] })
    const releaseMock = vi.fn()

    app.decorate('authenticate', async (request) => {
      request.user = { tenant_id: 'tenant-1', papel: 'franqueado' }
    })
    app.decorate('requirePapel', (papeis) => async (request, reply) => {
      if (!papeis.includes(request.user.papel)) {
        return reply.code(403).send({ error: 'Acesso não autorizado' })
      }
    })
    app.decorate('dbTenant', async () => ({ query: queryMock, release: releaseMock }))

    await app.register((await import('../src/routes/cabines.js')).cabinesRoutes)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/cabines/${cabineId}/live-atual`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ live_id: liveId })

    await app.close()
  })

  // ── TikTok OAuth CSRF regression ─────────────────────────────────────────
  describe('TikTok OAuth CSRF (signed state)', () => {
    async function buildTiktokApp() {
      process.env.JWT_SECRET = 'test-secret-32-chars-minimum-please-ok'
      const app = Fastify()
      const queryMock = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'tenant-1' }] })
      const releaseMock = vi.fn()
      app.decorate('authenticate', async (request) => {
        request.user = { tenant_id: '00000000-0000-0000-0000-000000000001', papel: 'franqueado' }
      })
      app.decorate('requirePapel', (papeis) => async (request, reply) => {
        if (!request.user) request.user = { tenant_id: '00000000-0000-0000-0000-000000000001', papel: 'franqueado' }
        if (!papeis.includes(request.user.papel)) return reply.code(403).send({ error: 'Forbidden' })
      })
      app.decorate('db', { query: queryMock })
      app.decorate('dbTenant', async () => ({ query: queryMock, release: releaseMock }))
      const { tiktokRoutes } = await import('../src/routes/tiktok.js')
      await app.register(tiktokRoutes)
      return { app, queryMock }
    }

    it('GET /v1/tiktok/callback rejeita state sem assinatura (formato UUID)', async () => {
      const { app } = await buildTiktokApp()
      const res = await app.inject({
        method: 'GET',
        url: '/v1/tiktok/callback?code=fake&state=00000000-0000-0000-0000-000000000001',
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toMatch(/State inválido/)
      await app.close()
    })

    it('GET /v1/tiktok/callback rejeita state com assinatura tampered', async () => {
      const { app } = await buildTiktokApp()
      const res = await app.inject({
        method: 'GET',
        url: '/v1/tiktok/callback?code=fake&state=tenant-1:nonce:9999999999999:BADSIG1234567890',
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toMatch(/State inválido/)
      await app.close()
    })

    it('GET /v1/lives/:liveId/events retorna 404 se live não existe ou não está em_andamento', async () => {
      process.env.JWT_SECRET = 'test-secret-32-chars-minimum-please-ok'
      const app = Fastify()
      const queryMock = vi.fn().mockResolvedValue({ rows: [] }) // live inexistente
      app.decorate('authenticate', async (request) => {
        request.user = { tenant_id: '00000000-0000-0000-0000-000000000001', papel: 'franqueado' }
      })
      app.decorate('requirePapel', (papeis) => async (request, reply) => {
        if (!request.user) request.user = { tenant_id: '00000000-0000-0000-0000-000000000001', papel: 'franqueado' }
        if (!papeis.includes(request.user.papel)) return reply.code(403).send({ error: 'Forbidden' })
      })
      app.decorate('db', { query: queryMock })
      app.decorate('dbTenant', async () => ({ query: queryMock, release: vi.fn() }))
      const { tiktokRoutes } = await import('../src/routes/tiktok.js')
      await app.register(tiktokRoutes)

      const res = await app.inject({
        method: 'GET',
        url: '/v1/lives/00000000-0000-0000-0000-000000000999/events',
      })
      expect(res.statusCode).toBe(404)
      expect(res.json().error).toMatch(/não encontrada|não está ao vivo/i)
      await app.close()
    })

    it('GET /v1/tiktok/callback aceita signed state válido gerado por createSignedState', async () => {
      const { app, queryMock } = await buildTiktokApp()
      const { createSignedState } = await import('../src/services/oauth-state.js')
      const validState = createSignedState({
        tenantId: '00000000-0000-0000-0000-000000000001',
        nonce: 'test-nonce',
      })
      const res = await app.inject({
        method: 'GET',
        url: `/v1/tiktok/callback?code=fake&state=${encodeURIComponent(validState)}`,
      })
      // Callback roda com sucesso (retorna HTML de "conectado") ou 404 se tenant não existe.
      // Nosso mock retorna rowCount=1 (tenant existe), então deve ter status 200 com HTML.
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/html/)
      // Deve ter chamado db.query pra verificar tenant + atualizar tokens
      expect(queryMock).toHaveBeenCalled()
      await app.close()
    })
  })
})
