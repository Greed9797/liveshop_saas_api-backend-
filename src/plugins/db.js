import fp from 'fastify-plugin'
import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

async function dbPlugin(app) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  })

  // Testa conexão na inicialização
  const client = await pool.connect()
  client.release()
  app.log.info('PostgreSQL conectado')

  // Decorator para queries simples (sem tenant)
  app.decorate('db', {
    query: (text, params) => pool.query(text, params),
    pool,
  })

  // Decorator para queries com RLS (com tenant_id do JWT)
  app.decorate('dbTenant', async (tenantId) => {
    const client = await pool.connect()
    await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId])
    return {
      query: (text, params) => client.query(text, params),
      release: () => client.release(),
    }
  })

  app.addHook('onClose', async () => pool.end())
}

export default fp(dbPlugin, { name: 'db' })
export { dbPlugin }
