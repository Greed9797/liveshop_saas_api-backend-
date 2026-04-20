import crypto from 'crypto';

const BASE_URL = process.env.ASAAS_SANDBOX === 'true'
  ? 'https://sandbox.asaas.com/api/v3'
  : 'https://api.asaas.com/v3';

/**
 * Realiza uma chamada à API Asaas.
 * Lança erro com mensagem legível se status >= 400.
 */
async function _request(method, path, body = null, idempotencyKey = null) {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) throw new Error('ASAAS_API_KEY não configurada');

  const options = {
    method,
    headers: {
      'access_token': apiKey,
      'Content-Type': 'application/json',
    },
  };
  if (idempotencyKey) options.headers['Idempotency-Key'] = idempotencyKey;
  if (body) options.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, options);
  } catch (networkErr) {
    throw new Error(`Asaas rede indisponível (${method} ${path}): ${networkErr.message}`);
  }

  const data = res.ok
    ? await res.json()
    : await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data.errors?.map(e => e.description).join('; ') ?? 'Erro desconhecido Asaas';
    throw new Error(`Asaas ${res.status}: ${msg}`);
  }

  return data;
}

/**
 * Busca customer pelo CPF/CNPJ. Cria se não existir.
 * Retorna o asaas_customer_id.
 */
export async function buscarOuCriarCustomer({ nome, cpfCnpj, email, celular }) {
  const cpfCnpjLimpo = cpfCnpj?.replace(/\D/g, '') ?? '';

  if (cpfCnpjLimpo) {
    const search = await _request('GET', `/customers?cpfCnpj=${cpfCnpjLimpo}`);
    if (search.data?.length > 0) {
      return search.data[0].id;
    }
  }

  try {
    const created = await _request('POST', '/customers', {
      name: nome,
      cpfCnpj: cpfCnpjLimpo || undefined,
      email: email || undefined,
      mobilePhone: celular?.replace(/\D/g, '') || undefined,
      notificationDisabled: false,
    });
    return created.id;
  } catch (err) {
    if (cpfCnpjLimpo && err.message.toLowerCase().includes('already')) {
      const retry = await _request('GET', `/customers?cpfCnpj=${cpfCnpjLimpo}`);
      if (retry.data?.length > 0) return retry.data[0].id;
    }
    throw err;
  }
}

/**
 * Gera chave de idempotência determinística.
 * Mesmo input SEMPRE gera o mesmo hash — impede cobranças duplicadas.
 */
export function gerarIdempotencyKey(tenantId, liveId, tipo) {
  return crypto
    .createHash('sha256')
    .update(`${tenantId}:${liveId}:${tipo}`)
    .digest('hex');
}

/**
 * Cria uma cobrança (boleto ou PIX) no Asaas.
 * Retorna: { id, invoiceUrl, pixCopiaECola }
 */
export async function criarCobranca({
  asaasCustomerId,
  valor,
  vencimento,       // 'YYYY-MM-DD'
  descricao,
  externalReference, // nosso boleto.id
  billingType = 'BOLETO',
  idempotencyKey = null,
}) {
  const BILLING_TYPES = new Set(['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED']);
  if (!BILLING_TYPES.has(billingType)) {
    throw new Error(`billingType inválido: ${billingType}. Use: BOLETO, PIX, CREDIT_CARD ou UNDEFINED`);
  }

  return await _request('POST', '/payments', {
    customer: asaasCustomerId,
    billingType,
    value: valor,
    dueDate: vencimento,
    description: descricao,
    externalReference,
    fine: { value: 2 },       // 2% de multa após vencimento
    interest: { value: 1 },   // 1% ao mês de juros
  }, idempotencyKey);
}

/**
 * Valida o token de webhook enviado pelo Asaas no header 'asaas-access-token'.
 * Usa comparação timing-safe para evitar timing attacks.
 * Lança erro se inválido — impede processamento de payloads falsos.
 */
export function validarWebhookToken(receivedToken) {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN ?? ''
  if (!expected || expected.length < 16) {
    throw new Error('ASAAS_WEBHOOK_TOKEN não configurado ou muito curto (mínimo 16 caracteres)')
  }
  if (!receivedToken || receivedToken.length !== expected.length) {
    throw new Error('Token de webhook Asaas inválido')
  }
  const a = Buffer.from(receivedToken)
  const b = Buffer.from(expected)
  if (!crypto.timingSafeEqual(a, b)) {
    throw new Error('Token de webhook Asaas inválido')
  }
}
