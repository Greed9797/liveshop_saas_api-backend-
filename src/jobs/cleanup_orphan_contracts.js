export async function cleanupOrphanContracts(app) {
  const expirationDays = Number(process.env.CONTRACT_EXPIRATION_DAYS ?? 5)

  const result = await app.db.query(
    `WITH expired AS (
       SELECT id, tenant_id, cliente_id
       FROM contratos
       WHERE status = 'reprovado'
         AND reviewed_at IS NOT NULL
         AND reviewed_at <= NOW() - ($1::text || ' days')::interval
         AND cancelado_automaticamente_em IS NULL
     ), updated_contratos AS (
       UPDATE contratos c
       SET status = 'cancelado_automaticamente',
           cancelado_automaticamente_em = NOW(),
           cancelado_em = NOW()
       FROM expired e
       WHERE c.id = e.id
       RETURNING c.id, c.tenant_id, c.cliente_id
     ), updated_clientes AS (
       UPDATE clientes cl
       SET status = 'cancelado_automaticamente',
           atualizado_em = NOW()
       FROM updated_contratos uc
       WHERE cl.id = uc.cliente_id
       RETURNING cl.id
     )
     INSERT INTO contrato_eventos (
       tenant_id,
       contrato_id,
       tipo_evento,
       actor_papel,
       payload_json
     )
      SELECT
        uc.tenant_id,
        uc.id,
        'contrato_cancelado_automaticamente',
        'system',
        jsonb_build_object('reason', 'prazo expirado sem decisão do franqueado')
      FROM updated_contratos uc
      RETURNING contrato_id`,
    [String(expirationDays)]
  )

  const total = result.rowCount ?? 0
  if (total > 0) {
    app.log.info({ total, expirationDays }, 'Contratos órfãos cancelados automaticamente')
  }

  return total
}
