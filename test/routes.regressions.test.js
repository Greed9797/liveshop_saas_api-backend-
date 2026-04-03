import Fastify from 'fastify'
import fp from 'fastify-plugin'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authPlugin } from '../src/plugins/auth.js'
import { financeiroRoutes } from '../src/routes/financeiro.js'
import { franqueadoRoutes } from '../src/routes/franqueado.js'

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
      request.user = { tenant_id: 'tenant-1' }
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
})
