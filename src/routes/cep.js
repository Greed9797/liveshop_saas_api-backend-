// src/routes/cep.js

export async function cepRoutes(app) {
  // GET /v1/cep/:cep → { logradouro, cidade, estado, lat, lng }
  app.get('/v1/cep/:cep', { preHandler: app.authenticate }, async (request, reply) => {
    const cep = request.params.cep.replace(/\D/g, '')
    if (cep.length !== 8) {
      return reply.code(400).send({ error: 'CEP deve ter 8 dígitos' })
    }

    // 1. ViaCEP para endereço
    let logradouro = null, cidade = null, estado = null
    try {
      const viacepResp = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
      const viacep = await viacepResp.json()
      if (!viacep.erro) {
        logradouro = viacep.logradouro || null
        cidade = viacep.localidade || null
        estado = viacep.uf || null
      }
    } catch {
      // Falha silenciosa — retorna sem endereço
    }

    // 2. Nominatim para lat/lng
    let lat = null, lng = null
    try {
      const nomResp = await fetch(
        `https://nominatim.openstreetmap.org/search?postalcode=${cep}&country=BR&format=json&limit=1`,
        { headers: { 'User-Agent': 'LiveShopSaaS/1.0 contact@liveshop.com.br' } }
      )
      const nomData = await nomResp.json()
      if (nomData.length > 0) {
        lat = parseFloat(nomData[0].lat)
        lng = parseFloat(nomData[0].lon)
      }
    } catch {
      // Falha silenciosa — retorna sem coordenadas
    }

    return { cep, logradouro, cidade, estado, lat, lng }
  })
}
