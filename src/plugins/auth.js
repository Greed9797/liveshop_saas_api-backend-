import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'

async function authPlugin(app) {
  await app.register(jwt, {
    secret: process.env.JWT_SECRET,
    sign: { expiresIn: process.env.JWT_EXPIRES_IN ?? '15m' },
  })

  // preHandler reutilizável: app.authenticate
  app.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify()
    } catch {
      reply.code(401).send({ error: 'Token inválido ou expirado' })
    }
  })

  // preHandler: verifica papel específico
  app.decorate('requirePapel', (papeis) => async (request, reply) => {
    try {
      await request.jwtVerify()
    } catch {
      return reply.code(401).send({ error: 'Não autenticado' })
    }
    if (!papeis.includes(request.user.papel)) {
      return reply.code(403).send({ error: 'Acesso não autorizado para este papel' })
    }
  })
}

export default fp(authPlugin, { name: 'auth', dependencies: ['db'] })
export { authPlugin }
