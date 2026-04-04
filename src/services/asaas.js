'use strict';

import crypto from 'crypto';

const BASE_URL = process.env.ASAAS_SANDBOX === 'true'
  ? 'https://sandbox.asaas.com/api/v3'
  : 'https://api.asaas.com/v3';

/**
 * Realiza uma chamada à API Asaas.
 * Lança erro com mensagem legível se status >= 400.
 */
async function _request(method, path, body = null) {
  const options = {
    method,
    headers: {
      'access_token': process.env.ASAAS_API_KEY,
      'Content-Type': 'application/json',
    },
  };

  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json();

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

  const created = await _request('POST', '/customers', {
    name: nome,
    cpfCnpj: cpfCnpjLimpo || undefined,
    email: email || undefined,
    mobilePhone: celular?.replace(/\D/g, '') || undefined,
    notificationDisabled: false,
  });

  return created.id;
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
}) {
  return await _request('POST', '/payments', {
    customer: asaasCustomerId,
    billingType,
    value: valor,
    dueDate: vencimento,
    description: descricao,
    externalReference,
    fine: { value: 2 },       // 2% de multa após vencimento
    interest: { value: 1 },   // 1% ao mês de juros
  });
}

/**
 * Valida o token de webhook enviado pelo Asaas no header 'asaas-access-token'.
 * Lança erro se inválido — impede processamento de payloads falsos.
 */
export function validarWebhookToken(receivedToken) {
  const expected = process.env.ASAAS_API_KEY;
  if (!receivedToken || receivedToken !== expected) {
    throw new Error('Token de webhook Asaas inválido');
  }
}
