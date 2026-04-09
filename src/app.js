import Fastify from 'fastify'
import cors from '@fastify/cors'
import { dbPlugin } from './plugins/db.js'
import { authPlugin } from './plugins/auth.js'
import { authRoutes } from './routes/auth.js'
import { homeRoutes } from './routes/home.js'
import { analyticsRoutes } from './routes/analytics.js'
import { clientesRoutes } from './routes/clientes.js'
import { contratosRoutes } from './routes/contratos.js'
import { financeiroRoutes } from './routes/financeiro.js'
import { cabinesRoutes } from './routes/cabines.js'
import { clienteDashboardRoutes } from './routes/cliente_dashboard.js'
import { leadsRoutes } from './routes/leads.js'
import { boletosRoutes } from './routes/boletos.js'
import { excelenciaRoutes } from './routes/excelencia.js'
import { recomendacoesRoutes } from './routes/recomendacoes.js'
import { franqueadoRoutes } from './routes/franqueado.js'
import { manuaisRoutes } from './routes/manuais.js'
import { tiktokRoutes } from './routes/tiktok.js'
import { cepRoutes } from './routes/cep.js'
import { configuracoesRoutes } from './routes/configuracoes.js'

export async function buildApp(opts = {}) {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    ...opts,
  })

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? true,
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  })
  await app.register(dbPlugin)
  await app.register(authPlugin)

  await app.register(authRoutes)
  await app.register(homeRoutes)
  await app.register(analyticsRoutes)
  await app.register(clientesRoutes)
  await app.register(contratosRoutes)
  await app.register(financeiroRoutes)
  await app.register(cabinesRoutes)
  await app.register(clienteDashboardRoutes)
  await app.register(leadsRoutes)
  await app.register(boletosRoutes)
  await app.register(excelenciaRoutes)
  await app.register(recomendacoesRoutes)
  await app.register(franqueadoRoutes)
  await app.register(manuaisRoutes)
  await app.register(tiktokRoutes)
  await app.register(cepRoutes)
  await app.register(configuracoesRoutes)

  app.get('/health', () => ({ ok: true }))

  return app
}
