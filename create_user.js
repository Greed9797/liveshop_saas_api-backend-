import 'dotenv/config';
import { Pool } from 'pg';

async function createUser() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const tenantResult = await pool.query('SELECT id FROM tenants LIMIT 1');
    if (tenantResult.rows.length === 0) {
        console.log('Nenhum tenant encontrado. Crie um tenant primeiro.');
        process.exit(1);
    }
    const tenantId = tenantResult.rows[0].id;

    const passwordHash = '$2b$10$wD112vLHL0kDHYGX.5osYe6ytw3BYACsGD5RIfLsFLCixeYEFw752';

    await pool.query(
      `INSERT INTO users (id, tenant_id, nome, email, senha_hash, papel, ativo)
       VALUES (gen_random_uuid(), $1, 'Vitor Miguel', 'vitormgdl22@gmail.com', $2, 'franqueado', true)
       ON CONFLICT (email) DO UPDATE SET senha_hash = $2, papel = 'franqueado'`,
      [tenantId, passwordHash]
    );

    console.log('Usuário vitormgdl22@gmail.com criado com sucesso!');
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
  } finally {
    await pool.end();
  }
}

createUser();
