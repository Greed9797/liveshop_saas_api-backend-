/**
 * Rotas de Integração OAuth com o TikTok
 * Responsável por conectar a conta do TikTok do Franqueado e gerar os Tokens
 */

import { getEmitter } from '../services/tiktok-connector-manager.js'

export async function tiktokRoutes(app) {
  // Configuração do App do TikTok (seria definido no .env na versão de produção)
  const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || 'SUA_CLIENT_KEY_AQUI';
  const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || 'SEU_CLIENT_SECRET_AQUI';
  // Endpoint de retorno após login do TikTok no painel de gestão do franqueado
  const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || 'https://api.liveshop.com.br/v1/tiktok/callback';

  /**
   * GET /v1/tiktok/connect
   * Gera a URL de OAuth do TikTok e retorna para o Frontend (Painel do Franqueado)
   */
  app.get('/v1/tiktok/connect', { preHandler: [app.authenticate, app.requirePapel(['franqueado'])] }, async (request, reply) => {
    // Usamos o tenantId no state para saber de qual tenant é esse callback
    const state = request.user.tenant_id;
    const scope = 'live.info.read,live.commerce.read'; // Escopos necessários
    const responseType = 'code';

    // URL oficial de autorização do TikTok V2
    const oauthUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${TIKTOK_CLIENT_KEY}&scope=${scope}&response_type=${responseType}&redirect_uri=${encodeURIComponent(TIKTOK_REDIRECT_URI)}&state=${state}`;

    return reply.send({ url: oauthUrl });
  });

  /**
   * GET /v1/tiktok/callback
   * Recebe o 'code' do TikTok após o login do usuário e troca por Access Token
   */
  app.get('/v1/tiktok/callback', async (request, reply) => {
    const { code, state, error, error_description } = request.query;

    if (error) {
      app.log.error(`[TikTok OAuth] Erro retornado pelo TikTok: ${error_description}`);
      return reply.code(400).send({ error: 'Autorização negada ou falhou no TikTok', detalhes: error_description });
    }

    if (!code || !state) {
      return reply.code(400).send({ error: 'Parâmetros code e state são obrigatórios' });
    }

    const tenantId = state;

    // Validar que state é um UUID válido antes de usar como tenant_id.
    // TODO: quando a integração real TikTok ativar, substituir por HMAC-signed token
    // que contenha tenant_id + timestamp + nonce para prevenir CSRF.
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRe.test(tenantId)) {
      return reply.code(400).send({ error: 'State inválido' })
    }

    try {
      // Verificar que o tenant existe antes de atualizar credenciais
      const tenantCheck = await app.db.query(`SELECT id FROM tenants WHERE id = $1`, [tenantId])
      if (tenantCheck.rowCount === 0) {
        return reply.code(404).send({ error: 'Tenant não encontrado' })
      }
      // Endpoint real para troca de código por token
      // POST https://open.tiktokapis.com/v2/oauth/token/
      // Na versão em produção isso seria um fetch (ou axios):
      
      /*
      const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: TIKTOK_CLIENT_KEY,
          client_secret: TIKTOK_CLIENT_SECRET,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: TIKTOK_REDIRECT_URI
        })
      });
      const data = await tokenResponse.json();
      */

      // Simulando o retorno de sucesso do TikTok
      const data = {
        access_token: `tk_live_${Math.random().toString(36).substring(7)}_${Date.now()}`,
        refresh_token: `tk_refresh_${Math.random().toString(36).substring(7)}`,
        expires_in: 86400, // 24 horas (em segundos)
        open_id: `user_${Math.random().toString(36).substring(7)}`
      };

      // Calcula a data de expiração real (agora + expires_in)
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + data.expires_in);

      // Usamos uma query limpa do pool (db.query) ao invés do dbTenant porque
      // a requisição vem do próprio TikTok, sem o Header de Authorization do nosso JWT
      await app.db.query(`
        UPDATE tenants
        SET 
          tiktok_access_token = $1,
          tiktok_refresh_token = $2,
          tiktok_token_expires_at = $3,
          tiktok_user_id = $4
        WHERE id = $5
      `, [
        data.access_token,
        data.refresh_token,
        expiresAt,
        data.open_id,
        tenantId
      ]);

      app.log.info(`[TikTok OAuth] Token salvo com sucesso para o tenant ${tenantId}`);

      // Redireciona o usuário de volta para o App Flutter ou exibe tela de sucesso
      // Em produção, isso redirecionaria para um Deep Link do app (ex: liveshop://tiktok/success)
      return reply.type('text/html').send(`
        <html>
          <body>
            <h2>TikTok Conectado com Sucesso!</h2>
            <p>Você já pode fechar esta janela e voltar para o aplicativo LiveShop.</p>
            <script>
              setTimeout(() => { window.close(); }, 3000);
            </script>
          </body>
        </html>
      `);

    } catch (err) {
      app.log.error(`[TikTok OAuth] Falha ao processar callback: ${err.message}`);
      return reply.code(500).send({ error: 'Falha ao processar a autenticação com o TikTok' });
    }
  });

  /**
   * GET /v1/tiktok/status
   * Verifica se o tenant atual já possui o TikTok conectado e token válido
   */
  app.get('/v1/tiktok/status', { preHandler: [app.authenticate, app.requirePapel(['franqueado'])] }, async (request, reply) => {
    // Como a rota é autenticada com franqueado, o JWT já tem o tenant_id
    const tenantId = request.user.tenant_id;
    const dbTenant = await app.dbTenant(tenantId);

    try {
      const result = await dbTenant.query(`
        SELECT 
          tiktok_access_token IS NOT NULL AS conectado,
          tiktok_token_expires_at
        FROM tenants
        WHERE id = $1
      `, [tenantId]);

      if (result.rowCount === 0) {
        return reply.code(404).send({ error: 'Tenant não encontrado' });
      }

      const info = result.rows[0];
      const isExpirado = info.tiktok_token_expires_at ? new Date() > new Date(info.tiktok_token_expires_at) : true;

      return reply.send({
        conectado: info.conectado,
        status: info.conectado && !isExpirado ? 'ativo' : (info.conectado && isExpirado ? 'expirado' : 'nao_conectado'),
        expira_em: info.tiktok_token_expires_at
      });

    } finally {
      dbTenant.release();
    }
  });

  // ── GET /v1/lives/:liveId/stream — SSE real-time ──────────────────────────
  app.get('/v1/lives/:liveId/stream', { preHandler: app.requirePapel(['franqueado', 'franqueador_master']) }, async (request, reply) => {
    const { tenant_id } = request.user
    const { liveId } = request.params

    // Validate live belongs to tenant and is active
    const { rows } = await app.db.query(
      `SELECT id FROM lives WHERE id = $1 AND tenant_id = $2 AND status = 'em_andamento'`,
      [liveId, tenant_id]
    )
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Live não encontrada ou não está ao vivo' })
    }

    // Take full control of the HTTP response
    reply.hijack()

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.flushHeaders()

    // Send the most recent snapshot immediately (initial state)
    try {
      const { rows: snap } = await app.db.query(
        `SELECT viewer_count, total_viewers, total_orders, gmv, likes_count, comments_count
         FROM live_snapshots
         WHERE live_id = $1
         ORDER BY captured_at DESC LIMIT 1`,
        [liveId]
      )
      if (snap[0]) {
        reply.raw.write(`data: ${JSON.stringify(snap[0])}\n\n`)
      }
    } catch (err) {
      app.log.warn({ err, liveId }, 'SSE: falha ao buscar snapshot inicial')
    }

    // Register listener on manager EventEmitter
    const emitter = getEmitter()
    const eventName = `snapshot:${liveId}`
    const handler = (snapshot) => {
      if (!reply.raw.destroyed) {
        reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`)
      }
    }
    emitter.on(eventName, handler)

    // Heartbeat every 15s to keep connection alive (prevents proxy timeouts)
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(': keep-alive\n\n')
    }, 15_000)

    // Wait for client disconnect
    await new Promise((resolve) => {
      request.raw.once('close', resolve)
      request.raw.once('error', resolve)
    })

    // Cleanup
    emitter.off(eventName, handler)
    clearInterval(heartbeat)
    try { reply.raw.end() } catch {}
  })
}
