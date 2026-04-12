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

  it('handler gift acumula diamantes e emite event:liveId', async () => {
    const liveId = 'live-gift-1'
    const db = makeDb([
      { id: liveId, tenant_id: 'tenant-1', tiktok_username: 'user_test' },
    ])
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    init({ db, log })

    await syncLives()

    const receivedEvents = []
    getEmitter().on(`event:${liveId}`, (evt) => receivedEvents.push(evt))

    const { WebcastPushConnection } = await import('tiktok-live-connector')
    const connection = WebcastPushConnection.mock.instances.at(-1)
    const giftCall = connection.on.mock.calls.find(([evt]) => evt === 'gift')
    expect(giftCall).toBeDefined()
    const giftHandler = giftCall[1]

    // Streak em progresso — NÃO deve contar
    giftHandler({
      giftType: 1, repeatEnd: false, repeatCount: 3,
      diamondCount: 10, uniqueId: 'alice', giftName: 'Rose',
    })
    expect(receivedEvents.length).toBe(0)

    // Streak finalizado — conta multiplicado
    giftHandler({
      giftType: 1, repeatEnd: true, repeatCount: 3,
      diamondCount: 10, uniqueId: 'alice', giftName: 'Rose',
    })
    expect(receivedEvents.length).toBe(1)
    expect(receivedEvents[0]).toMatchObject({
      type: 'gift', user: 'alice', giftName: 'Rose', diamonds: 30, repeatCount: 3,
    })

    // Gift único (não-streak) — conta imediato
    giftHandler({
      giftType: 2, diamondCount: 50,
      uniqueId: 'bob', giftName: 'Galaxy',
    })
    expect(receivedEvents.length).toBe(2)
    expect(receivedEvents[1]).toMatchObject({
      type: 'gift', user: 'bob', giftName: 'Galaxy', diamonds: 50,
    })
  })

  it('_flushToDb persiste gifts_diamonds e shares_count nos snapshots', async () => {
    const liveId = 'live-flush-1'
    const db = makeDb([
      { id: liveId, tenant_id: 'tenant-1', tiktok_username: 'user_test' },
    ])
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    init({ db, log })

    await syncLives()

    // Fire roomUser pra marcar dirty e garantir flush
    const { WebcastPushConnection } = await import('tiktok-live-connector')
    const connection = WebcastPushConnection.mock.instances.at(-1)
    const roomUserHandler = connection.on.mock.calls.find(([evt]) => evt === 'roomUser')[1]
    roomUserHandler({ viewerCount: 42 })

    // Limpa queries do start e força resolved value pra UPDATE lives do stopConnector
    db.query.mockClear()
    db.query.mockResolvedValue({ rows: [] })

    await stopConnector(liveId)

    const insertCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO live_snapshots'))
    expect(insertCall).toBeDefined()
    expect(insertCall[0]).toContain('gifts_diamonds')
    expect(insertCall[0]).toContain('shares_count')
  })
})
