// src/server.js
import 'dotenv/config'
import cron from 'node-cron'
import { buildApp } from './app.js'
import { TikTokService } from './services/tiktok.js'
import { cleanupOrphanContracts } from './jobs/cleanup_orphan_contracts.js'
import * as connectorManager from './services/tiktok-connector-manager.js'

const app = await buildApp()

// Initialize ConnectorManager with pool access and logger
connectorManager.init({ db: app.db, log: app.log })

await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' })
console.log(`LiveShop API rodando na porta ${process.env.PORT ?? 3001}`)

// TikTok data collection every 60s:
// 1. Polling fallback (keeps live_snapshots updated even without connector)
// 2. Reconciliation loop (starts/stops connectors for ao_vivo lives)
cron.schedule('*/60 * * * * *', async () => {
  try {
    await TikTokService.pollAllTenants(app.db)
  } catch (err) {
    app.log.error({ err }, 'TikTok polling falhou')
  }
  try {
    await connectorManager.syncLives()
  } catch (err) {
    app.log.error({ err }, 'connectorManager.syncLives falhou')
  }
})

// Daily cleanup of rejected contracts without franqueado decision for 5 days
cron.schedule('0 3 * * *', async () => {
  try {
    await cleanupOrphanContracts(app)
  } catch (error) {
    app.log.error({ error }, 'Falha ao limpar contratos órfãos')
  }
})
