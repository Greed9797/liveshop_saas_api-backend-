/**
 * Rotas do painel master do franqueador
 * GET /v1/franqueado/unidades — lista sub-unidades com métricas consolidadas
 */
export async function franqueadoRoutes(app) {
  app.get(
    '/v1/franqueado/unidades',
    { onRequest: [app.authenticate, app.requirePapel(['franqueador_master'])] },
    async (req, reply) => {
      const { rows } = await app.db.query(`
        SELECT
          t.id,
          t.nome,
          COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'ativo')     AS clientes_count,
          COALESCE(SUM(l.fat_gerado), 0)                             AS fat_mes,
          COUNT(DISTINCT ct.id) FILTER (
            WHERE ct.status IN ('gerado','enviado','em_analise'))     AS contratos_pendentes,
          CASE WHEN COUNT(DISTINCT u.id) > 0 THEN 'ativo' ELSE 'inativo' END AS status
        FROM tenants t
        LEFT JOIN users      u  ON u.tenant_id = t.id AND u.ativo = TRUE
        LEFT JOIN clientes   c  ON c.tenant_id = t.id
        LEFT JOIN contratos  ct ON ct.tenant_id = t.id
        LEFT JOIN lives      l  ON l.tenant_id = t.id
          AND date_trunc('month', l.iniciado_em) = date_trunc('month', NOW())
        WHERE t.id != $1
        GROUP BY t.id, t.nome
        ORDER BY fat_mes DESC
      `, [req.user.tenant_id])

      return reply.send(rows)
    }
  )
}
