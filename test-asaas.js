require('dotenv').config();
const asaas = require('./src/services/asaas');

console.log('Module loaded, exports:', Object.keys(asaas));

if (!asaas.gerarIdempotencyKey) {
  console.error('ERROR: gerarIdempotencyKey not exported');
  process.exit(1);
}

const key = asaas.gerarIdempotencyKey('tenant-123', 'live-456', 'royalties');
console.assert(key.length === 64, 'SHA256 deve ter 64 chars');
console.log('✅ gerarIdempotencyKey OK:', key.slice(0,16) + '...');

try {
  asaas.validarWebhookToken('token-errado');
  console.log('❌ Deveria ter lançado erro');
  process.exit(1);
} catch (e) {
  console.log('✅ validarWebhookToken rejeita token inválido OK');
}

console.log('\nAll tests passed!');
