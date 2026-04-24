import pg from 'pg'
import fs from 'fs'
import path from 'path'
import 'dotenv/config'

const pool = new pg.Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

async function runMigration(fileName) {
  const filePath = path.join(process.cwd(), 'migrations', fileName)
  if (!fs.existsSync(filePath)) {
    console.log(`Migration ignorada (não encontrada): ${fileName}`)
    return
  }

  const sql = fs.readFileSync(filePath, 'utf8')
  try {
    console.log(`Aplicando ${fileName}...`)
    await pool.query(sql)
    console.log(`✅ ${fileName} aplicada com sucesso!`)
  } catch (err) {
    console.error(`❌ Erro ao aplicar ${fileName}:`, err.message)
    // Continua para a próxima para não travar o script inteiro, 
    // útil se a tabela já existir (idempotência falha em alguns casos do SQL original).
  }
}

async function main() {
  console.log('Iniciando atualização do banco de dados (Migrations)...')
  
  // Vamos garantir as últimas migrations do SaaS
  const pendingMigrations = [
    '016_auditoria_implantacao.sql',
    '017_cabines_reservas_eventos.sql',
    '018_lives_analytics_indexes.sql',
    '019_asaas_integration.sql',
    '020_asaas_integration_fixes.sql',
    '021_tiktok_live_connector.sql',
    '022_tenant_settings.sql',
    '023_billing_batch_setup.sql',
    '024_schema_fixes.txt',          // meta_diaria_gmv em tenants + índices FK
    '025_create_live_requests.txt',  // tabela live_requests (solicitações de live)
    '026_add_analytics_dashboard_indexes.txt',
    '029_lives_tiktok_fields.txt',   // campos TikTok em lives + live_snapshots
    '030_create_pacotes.sql',
    '031_pacotes_contratos_horas.sql',
    '032_cabines_config.sql',
    '033_add_roles_apresentador_gerente.sql',
    '034_contratos_pacote.sql',
    '035_manuais_metadata.sql',
    '036_cabines_ativo.sql',         // coluna ativo em cabines
  ]

  for (const migration of pendingMigrations) {
    await runMigration(migration)
  }

  console.log('\nProcesso de migrations finalizado.')
  await pool.end()
}

main()
