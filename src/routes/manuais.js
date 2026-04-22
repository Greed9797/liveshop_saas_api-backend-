/**
 * Rotas de manuais e documentos
 * GET /v1/manuais — lista documentos disponíveis para perfis operacionais
 */
export async function manuaisRoutes(app) {
  app.get(
    '/v1/manuais',
    {
      onRequest: [
        app.authenticate,
        app.requirePapel(['franqueado', 'gerente', 'cliente_parceiro']),
      ],
    },
    async (_req, reply) => {
      const { rows } = await app.db.query(`
        SELECT id, titulo, url, atualizado_em, categoria, paginas, destaque
        FROM manuais
        ORDER BY destaque DESC, atualizado_em DESC
      `)
      return reply.send(rows)
    }
  )
}
