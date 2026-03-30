import fs from 'fs'
import pg from 'pg'
import 'dotenv/config'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

async function run() {
  try {
    const file12 = fs.readFileSync('./migrations/012_add_tiktok_tokens_to_tenants.sql', 'utf8')
    const file13 = fs.readFileSync('./migrations/013_create_live_snapshots.sql', 'utf8')
    const file14 = fs.readFileSync('./migrations/014_create_live_products.sql', 'utf8')
    
    console.log('Rodando migration 012...')
    await pool.query(file12)
    
    console.log('Rodando migration 013...')
    await pool.query(file13)
    
    console.log('Rodando migration 014...')
    await pool.query(file14)
    
    console.log('Migrações aplicadas com sucesso!')
  } catch (err) {
    console.error('Erro ao rodar migrações:', err)
  } finally {
    await pool.end()
  }
}

run()
