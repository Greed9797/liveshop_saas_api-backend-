// test/tiktok-connector-manager.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock tiktok-live-connector before importing the manager
vi.mock('tiktok-live-connector', () => ({
  WebcastPushConnection: vi.fn().mockImplementation(function(username) {
    this.username = username
    this.connect = vi.fn().mockResolvedValue(undefined)
    this.disconnect = vi.fn().mockResolvedValue(undefined)
    this.on = vi.fn()
    this.off = vi.fn()
  }),
}))

// Import after mock
const { init, syncLives, stopConnector, has, getEmitter, _resetForTests } =
  await import('../src/services/tiktok-connector-manager.js')

const makeDb = (rows = []) => ({
  query: vi.fn().mockResolvedValue({ rows }),
})

beforeEach(() => {
  _resetForTests()
})

describe('TikTokConnectorManager', () => {
  it('init armazena db e log', () => {
    const db = makeDb()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    init({ db, log })
    expect(getEmitter()).toBeDefined()
  })

  it('syncLives inicia connector para live ao_vivo sem connector ativo', async () => {
    const liveId = 'live-uuid-1'
    const db = makeDb([
      { id: liveId, tenant_id: 'tenant-1', tiktok_username: 'user_test' },
    ])
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    init({ db, log })

    await syncLives()

    expect(has(liveId)).toBe(true)
  })

  it('syncLives para connector quando live sai do resultado', async () => {
    const liveId = 'live-uuid-2'
    const db = makeDb([
      { id: liveId, tenant_id: 'tenant-1', tiktok_username: 'user_test' },
    ])
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    init({ db, log })

    await syncLives() // Inicia
    expect(has(liveId)).toBe(true)

    // Simular live que sumiu do resultado (encerrada)
    db.query.mockResolvedValue({ rows: [] })
    await syncLives() // Para

    expect(has(liveId)).toBe(false)
  })

  it('syncLives não duplica connectors se já existe', async () => {
    const liveId = 'live-uuid-3'
    const db = makeDb([
      { id: liveId, tenant_id: 'tenant-1', tiktok_username: 'user_test' },
    ])
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    init({ db, log })

    await syncLives()
    await syncLives() // Segunda chamada não deve duplicar

    expect(has(liveId)).toBe(true)
    // Deve ter chamado query para live_products apenas uma vez (no startConnector inicial)
    const callCount = db.query.mock.calls.filter(([sql]) => sql.includes('live_products')).length
    expect(callCount).toBe(1)
  })

  it('getEmitter retorna o mesmo emitter sempre', () => {
    init({ db: makeDb(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
    const e1 = getEmitter()
    const e2 = getEmitter()
    expect(e1).toBe(e2)
  })
})
