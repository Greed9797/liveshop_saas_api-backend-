/**
 * Rotas de manuais e documentos
 * GET /v1/manuais — lista documentos disponíveis (sem RLS, todos os autenticados)
 */
export async function manuaisRoutes(app) {
  app.get(
    '/v1/manuais',
    { onRequest: [app.authenticate] },
    async (_req, reply) => {
      const { rows } = await app.db.query(`
        SELECT id, titulo, url, atualizado_em
        FROM manuais
        ORDER BY atualizado_em DESC
      `)
      return reply.send(rows)
    }
  )
}
