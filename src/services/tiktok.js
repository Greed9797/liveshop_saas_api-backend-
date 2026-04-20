export class TikTokService {
  /**
   * Busca dados da live ativa do tenant via API do TikTok
   */
  static async getLiveData(tenantId, accessToken) {
    try {
      // Endpoint real da TikTok Live API
      // GET https://open.tiktokapis.com/v2/live/info/
      // Aqui teremos a chamada real com 'fetch' quando a API de app real do TikTok for conectada
      
      // Simulando retorno para a integração:
      console.log(`[TikTok] Buscando dados da live para o tenant: ${tenantId}`);
      
      return {
        // null indica que não há live ativa no momento
        live_id: null,
        status: 'offline', // 'ao_vivo' ou 'offline'
        viewer_count: 0,
        total_viewers: 0,
        duration_seconds: 0,
        title: '',
        total_orders: 0,
        total_gmv: 0.00,
        products_sold: []
      };
    } catch (error) {
      console.error(`[TikTok] Erro ao buscar dados da live do tenant ${tenantId}:`, error);
      return null;
    }
  }

  /**
   * Renova token de acesso se expirado (OAuth 2.0 TikTok)
   */
  static async refreshToken(db, tenantId, currentRefreshToken) {
    const clientKey    = process.env.TIKTOK_CLIENT_KEY
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET
    if (!clientKey || !clientSecret) {
      console.warn(`[TikTok] Credenciais OAuth ausentes — não é possível renovar token do tenant ${tenantId}`)
      return false
    }
    try {
      const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: currentRefreshToken,
        }).toString(),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error_description ?? data.error)

      const expiresAt = new Date(Date.now() + data.expires_in * 1000)
      await db.query(
        `UPDATE tenants SET tiktok_access_token=$1, tiktok_refresh_token=$2, tiktok_token_expires_at=$3 WHERE id=$4`,
        [data.access_token, data.refresh_token, expiresAt, tenantId]
      )
      console.log(`[TikTok] Token renovado para tenant ${tenantId}`)
      return true
    } catch (error) {
      console.error(`[TikTok] Erro ao renovar token do tenant ${tenantId}:`, error.message)
      return false
    }
  }

  static async refreshAllExpiringTokens(db) {
    const { rows } = await db.query(`
      SELECT id, tiktok_refresh_token FROM tenants
      WHERE tiktok_access_token IS NOT NULL
        AND tiktok_refresh_token IS NOT NULL
        AND tiktok_token_expires_at < NOW() + INTERVAL '7 days'
    `)
    for (const tenant of rows) {
      await TikTokService.refreshToken(db, tenant.id, tenant.tiktok_refresh_token)
    }
  }

  /**
   * Cron job: coleta dados de todos os tenants ativos a cada 60s
   */
  static async pollAllTenants(db) {
    console.log('[TikTok Cron] Iniciando polling para todos os tenants...');
    
    try {
      // Busca tenants ativos e com token do TikTok configurado
      const result = await db.query(`
        SELECT id, tiktok_access_token, tiktok_refresh_token, tiktok_token_expires_at
        FROM tenants
        WHERE ativo = true
          AND tiktok_access_token IS NOT NULL
      `);

      const tenants = result.rows;

      for (const tenant of tenants) {
        try {
          // 1. Verifica se token expirou (aqui ficaria a lógica verificando o tiktok_token_expires_at)
          // await this.refreshToken(tenant.id, tenant.tiktok_refresh_token, db);

          // 2. Busca dados da live na API do TikTok
          const liveData = await this.getLiveData(tenant.id, tenant.tiktok_access_token);
          
          if (!liveData) continue;

          // Executar as queries com o contexto RLS do tenant
          // O hook dbTenant(tenant_id) do plugin DB é usado para forçar a segurança da query
          // No app context real, injetaremos o tenant context na query ou faremos a query direta
          // (Como estamos rodando um cron de background logado como root do db, as queries aqui 
          // usam db.query direto mas com WHERE tenant_id explícito)

          if (liveData.status === 'ao_vivo' && liveData.live_id) {
            
            // a. Atualiza cabines.status = 'ao_vivo' e vincula a live atual
            // (Essa parte buscaria a cabine correta do franqueado, ex: a que ele marcou pra usar)
            // UPDATE cabines SET status = 'ao_vivo', live_atual_id = $1 WHERE tenant_id = $2...

            // b. Insere registro em live_snapshots (viewers, gmv, timestamp)
            await db.query(`
              INSERT INTO live_snapshots (live_id, tenant_id, viewer_count, total_viewers, total_orders, gmv)
              VALUES ($1, $2, $3, $4, $5, $6)
            `, [
              liveData.live_id,
              tenant.id,
              liveData.viewer_count,
              liveData.total_viewers,
              liveData.total_orders,
              liveData.total_gmv
            ]);

            // c. Atualiza lives.fat_gerado com o GMV atual
            await db.query(`
              UPDATE lives
              SET fat_gerado = $1
              WHERE id = $2 AND tenant_id = $3
            `, [liveData.total_gmv, liveData.live_id, tenant.id]);
            
            console.log(`[TikTok Cron] Snapshot salvo para tenant ${tenant.id} - Live: ${liveData.live_id}`);

          } else if (liveData.status === 'offline') {
            
            // 3. Se live encerrada:
            // a. Finaliza o registro em lives (encerrado_em, fat_gerado final)
            // b. Atualiza cabines.status = 'disponivel' e remove live_atual_id
            
            // Pega a última live ativa deste tenant que precisa ser finalizada
            const activeLiveResult = await db.query(`
              SELECT id FROM lives 
              WHERE tenant_id = $1 AND status = 'em_andamento'
              LIMIT 1
            `, [tenant.id]);

            if (activeLiveResult.rowCount > 0) {
              const liveId = activeLiveResult.rows[0].id;
              
              // Atualiza status da live
              await db.query(`
                UPDATE lives 
                SET status = 'encerrada', encerrado_em = NOW() 
                WHERE id = $1 AND tenant_id = $2
              `, [liveId, tenant.id]);

              // Atualiza cabine
              await db.query(`
                UPDATE cabines 
                SET status = 'disponivel', live_atual_id = NULL 
                WHERE live_atual_id = $1 AND tenant_id = $2
              `, [liveId, tenant.id]);
              
              console.log(`[TikTok Cron] Live ${liveId} do tenant ${tenant.id} encerrada.`);
            }
          }

        } catch (tenantError) {
          console.error(`[TikTok Cron] Erro ao processar dados do tenant ${tenant.id}:`, tenantError);
        }
      }
      
      console.log('[TikTok Cron] Polling finalizado.');
      
    } catch (error) {
      console.error('[TikTok Cron] Erro geral ao executar o polling das lives:', error);
    }
  }
}
