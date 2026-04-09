import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'

async function authPlugin(app) {
  await app.register(jwt, {
    secret: process.env.JWT_SECRET,
    sign: { expiresIn: process.env.JWT_EXPIRES_IN ?? '15m' },
  })

  const isDevBypassEnabled =
    process.env.USE_DEV_BYPASS === 'true' && process.env.NODE_ENV !== 'production'

  if (isDevBypassEnabled) {
    app.log.warn('USE_DEV_BYPASS is enabled (non-production only)')
  }

  function getBypassUser() {
    return {
      sub: process.env.DEV_BYPASS_USER_ID ?? '6b2e1a87-fefa-4547-b087-0403193af599',
      tenant_id: process.env.DEV_BYPASS_TENANT_ID ?? '00000000-0000-0000-0000-000000000001',
      papel: process.env.DEV_BYPASS_ROLE ?? 'franqueado',
      nome: process.env.DEV_BYPASS_NAME ?? 'Vitor Miguel',
    }
  }

  // preHandler reutilizável: app.authenticate
  app.decorate('authenticate', async function (request, reply) {
    if (isDevBypassEnabled) {
      request.user = getBypassUser()
      return
    }

    try {
      await request.jwtVerify()
    } catch (err) {
      app.log.warn({ msg: err.message, code: err.code }, 'JWT verification failed')
      return reply.code(401).send({ error: 'Token inválido ou expirado' })
    }
  })

  // preHandler: verifica papel específico
  app.decorate('requirePapel', (requiredPapeis) => async (request, reply) => {
    const papeis = Array.isArray(requiredPapeis) ? requiredPapeis : [requiredPapeis]

    if (isDevBypassEnabled) {
      request.user = getBypassUser()
    }

    if (!request.user) {
      try {
        await request.jwtVerify()
      } catch {
        return reply.code(401).send({ error: 'Não autenticado' })
      }
    }

    if (!papeis.includes(request.user.papel)) {
      return reply.code(403).send({ error: 'Acesso não autorizado para este papel' })
    }

    return
  })
}

export default fp(authPlugin, { name: 'auth', dependencies: ['db'] })
export { authPlugin }
