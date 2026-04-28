# Graph Report - /Users/vitormiguelgoedertdaluz/liveshop_saas_api-backend-  (2026-04-18)

## Corpus Check
- 0 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 165 nodes · 139 edges · 55 communities detected
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]

## God Nodes (most connected - your core abstractions)
1. `TikTok Integration Spec` - 7 edges
2. `TikTok Connector Manager` - 6 edges
3. `login()` - 4 edges
4. `processTenantBilling()` - 4 edges
5. `syncLives()` - 4 edges
6. `_sign()` - 4 edges
7. `criarCobranca()` - 4 edges
8. `TikTokService` - 4 edges
9. `executarAcaoAuditoria()` - 3 edges
10. `has()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `TikTok Connector Manager` --references--> `live_snapshots table`  [EXTRACTED]
  docs/specs/2026-04-12-tiktok-integration.md → migrations/029_lives_tiktok_fields.txt
- `TikTok Connector Manager` --populates--> `tiktok_room_id column`  [EXTRACTED]
  docs/specs/2026-04-12-tiktok-integration.md → migrations/029_lives_tiktok_fields.txt
- `TikTok Connector Manager` --populates--> `final_peak_viewers column`  [EXTRACTED]
  docs/specs/2026-04-12-tiktok-integration.md → migrations/029_lives_tiktok_fields.txt
- `criarCobranca()` --calls--> `has()`  [INFERRED]
  /Users/vitormiguelgoedertdaluz/liveshop_saas_api-backend-/src/services/asaas.js → /Users/vitormiguelgoedertdaluz/liveshop_saas_api-backend-/src/services/tiktok-connector-manager.js
- `live_requests table` --shares_data_with--> `LiveShop SaaS Backend`  [EXTRACTED]
  migrations/025_create_live_requests.txt → STATUS.md

## Communities

### Community 0 - "Community 0"
Cohesion: 0.14
Nodes (18): Asaas Service, Billing Engine, Circuit Breaker, final_peak_viewers column, Franqueado Analytics route, live_requests table, live_snapshots table, lives table (+10 more)

### Community 1 - "Community 1"
Cohesion: 0.29
Nodes (5): buscarOuCriarCustomer(), criarCobranca(), gerarIdempotencyKey(), _request(), processTenantBilling()

### Community 2 - "Community 2"
Cohesion: 0.29
Nodes (5): _flushToDb(), has(), startConnector(), stopConnector(), syncLives()

### Community 3 - "Community 3"
Cohesion: 0.29
Nodes (2): countSemanticsNodes(), waitForScreenWithNodes()

### Community 4 - "Community 4"
Cohesion: 0.43
Nodes (5): executarAcaoAuditoria(), getClientIp(), insertContratoEvento(), normalizeClientIp(), updateClienteStatusFromContrato()

### Community 5 - "Community 5"
Cohesion: 0.33
Nodes (0): 

### Community 6 - "Community 6"
Cohesion: 0.7
Nodes (4): login(), loginCliente(), loginFranqueado(), loginMaster()

### Community 7 - "Community 7"
Cohesion: 0.5
Nodes (2): cabineRoleAccess(), cabinesRoutes()

### Community 8 - "Community 8"
Cohesion: 0.7
Nodes (4): createSignedState(), _secret(), _sign(), verifySignedState()

### Community 9 - "Community 9"
Cohesion: 0.5
Nodes (1): TikTokService

### Community 10 - "Community 10"
Cohesion: 0.5
Nodes (0): 

### Community 11 - "Community 11"
Cohesion: 0.67
Nodes (2): enableA11y(), loginViaAPI()

### Community 12 - "Community 12"
Cohesion: 0.83
Nodes (4): cliente_parceiro role, Live Shop Flutter UI, Minhas Cabines sidebar button, solicitacao-booking E2E test

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (2): main(), runMigration()

### Community 14 - "Community 14"
Cohesion: 0.67
Nodes (0): 

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (0): 

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (2): leads RLS policy, Migration 024

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (1): Login Screen

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (1): Migration 026

## Knowledge Gaps
- **11 isolated node(s):** `LiveShop REST API (Fastify 5)`, `live_snapshots table`, `leads RLS policy`, `Migration 029`, `tiktok_room_id column` (+6 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 15`** (2 nodes): `createTestUsers()`, `seed_users.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (2 nodes): `createUser()`, `create_user.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (2 nodes): `createDemoData()`, `seed_demo_data.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (2 nodes): `buildTiktokApp()`, `routes.regressions.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (2 nodes): `makeDb()`, `tiktok-connector-manager.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (2 nodes): `buildApp()`, `app.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (2 nodes): `dbPlugin()`, `db.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (2 nodes): `authPlugin()`, `auth.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (2 nodes): `cleanupOrphanContracts()`, `cleanup_orphan_contracts.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (2 nodes): `configuracoesRoutes()`, `configuracoes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (2 nodes): `excelenciaRoutes()`, `excelencia.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (2 nodes): `recomendacoesRoutes()`, `recomendacoes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (2 nodes): `pacotesRoutes()`, `pacotes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (2 nodes): `franqueadoRoutes()`, `franqueado.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (2 nodes): `cepRoutes()`, `cep.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `boletosRoutes()`, `boletos.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (2 nodes): `authRoutes()`, `auth.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (2 nodes): `usuarios.js`, `usuariosRoutes()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (2 nodes): `homeRoutes()`, `home.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (2 nodes): `solicitacoesRoutes()`, `solicitacoes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (2 nodes): `manuaisRoutes()`, `manuais.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (2 nodes): `analyticsRoutes()`, `analytics.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (2 nodes): `leadsRoutes()`, `leads.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (2 nodes): `clienteDashboardRoutes()`, `cliente_dashboard.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (2 nodes): `contratosRoutes()`, `contratos.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (2 nodes): `tiktokRoutes()`, `tiktok.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (2 nodes): `clientesRoutes()`, `clientes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (2 nodes): `leads RLS policy`, `Migration 024`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `test-asaas.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (1 nodes): `oauth-state.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `playwright.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `dashboard.spec.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `role-access.spec.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `cabines.spec.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `auth.spec.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `financeiro.spec.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `server.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `auth.schema.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `Login Screen`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `Migration 026`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.