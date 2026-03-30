import 'dotenv/config'
import cron from 'node-cron'
import { buildApp } from './app.js'
import { TikTokService } from './services/tiktok.js'

const app = await buildApp()
await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' })
console.log(`LiveShop API rodando na porta ${process.env.PORT ?? 3001}`)

// Coleta dados do TikTok a cada 60 segundos
cron.schedule('*/60 * * * * *', async () => {
  await TikTokService.pollAllTenants(app.db)
})
