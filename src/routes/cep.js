// src/routes/cep.js

export async function cepRoutes(app) {
  app.get('/v1/cep/:cep', { preHandler: app.authenticate }, async (request, reply) => {
    const cep = request.params.cep.replace(/\D/g, '')
    if (cep.length !== 8) {
      return reply.code(400).send({ error: 'CEP deve ter 8 dígitos' })
    }

    // Run both lookups in parallel
    const [viacepResult, nominatimResult] = await Promise.allSettled([
      fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(5000) }),
      fetch(
        `https://nominatim.openstreetmap.org/search?postalcode=${cep}&country=BR&format=json&limit=1`,
        {
          headers: { 'User-Agent': 'LiveShopSaaS/1.0 contact@liveshop.com.br' },
          signal: AbortSignal.timeout(5000),
        }
      ),
    ])

    // ViaCEP
    let logradouro = null, cidade = null, estado = null
    if (viacepResult.status === 'fulfilled' && viacepResult.value.ok) {
      try {
        const viacep = await viacepResult.value.json()
        if (!viacep.erro) {
          logradouro = viacep.logradouro || null
          cidade = viacep.localidade || null
          estado = viacep.uf || null
        }
      } catch { /* malformed JSON — ignore */ }
    }

    // Nominatim
    let lat = null, lng = null
    if (nominatimResult.status === 'fulfilled' && nominatimResult.value.ok) {
      try {
        const nomData = await nominatimResult.value.json()
        if (Array.isArray(nomData) && nomData.length > 0) {
          lat = parseFloat(nomData[0].lat) || null
          lng = parseFloat(nomData[0].lon) || null
        }
      } catch { /* malformed JSON — ignore */ }
    }

    return { cep, logradouro, cidade, estado, lat, lng }
  })
}
