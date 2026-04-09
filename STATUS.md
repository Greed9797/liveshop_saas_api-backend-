# STATUS

## Resumo
- Backend Fastify funcional localmente.
- `npm test` passa com `18/18` testes.
- Há mudanças locais ainda nao commitadas que extendem analytics, cabine lifecycle, cliente dashboard e auditoria de contratos.
- O backend ja tem features commitadas recentes de TikTok Live realtime, SSE e Asaas.

## Estado Atual
- App principal em `src/app.js` ja registra `analyticsRoutes`.
- `src/server.js` inicializa cron de TikTok polling, `connectorManager.syncLives()` e cleanup diario de contratos orfaos.
- Fluxo de live/cabine atual:
  - reservar cabine
  - iniciar live
  - encerrar live
  - gerar boleto de royalties no Asaas
  - parar connector TikTok e flush final de snapshot
- Cliente parceiro possui dashboard consultivo com proxima reserva e benchmarks.
- Franqueado possui endpoint de analytics consolidado com ranking e heatmap.

## Mudancas Pendentes no Worktree

### Arquivos modificados
- `src/app.js`
- `src/routes/cliente_dashboard.js`
- `src/routes/leads.js`

### Arquivos novos
- `create_user.js`
- `migrations/016_auditoria_implantacao.sql`
- `migrations/017_cabines_reservas_eventos.sql`
- `migrations/018_lives_analytics_indexes.sql`
- `src/jobs/cleanup_orphan_contracts.js`
- `src/routes/analytics.js`
- `src/services/contratos_auditoria.js`
- `test-asaas.js`

## Features Ja Integradas e Relevantes

### TikTok realtime
- `src/services/tiktok-connector-manager.js`
- `src/routes/tiktok.js`
- `migrations/021_tiktok_live_connector.sql`

Capacidades:
- reconciliacao de lives ativas por cron
- connectors por `tiktok_username`
- flush periodico em `live_snapshots`
- SSE em `/v1/lives/:liveId/stream`
- likes e comments no snapshot

### Asaas
- `migrations/019_asaas_integration.sql`
- `migrations/020_asaas_integration_fixes.sql`
- `src/routes/boletos.js`

Capacidades:
- campos Asaas em `boletos`
- `webhook_eventos` imutavel
- webhook seguro por token
- cobranca automatica de royalties ao encerrar live

## Agrupamento Recomendado de Commits Pendentes

### Commit 1: analytics e dashboard consultivo
Escopo:
- `src/routes/analytics.js`
- `src/app.js`
- `src/routes/cliente_dashboard.js`

Mensagem sugerida:
- `feat: add franqueado analytics and expand cliente dashboard`

### Commit 2: cabine lifecycle e auditoria contratual
Escopo:
- `migrations/016_auditoria_implantacao.sql`
- `migrations/017_cabines_reservas_eventos.sql`
- `migrations/018_lives_analytics_indexes.sql`
- `src/routes/leads.js`
- `src/services/contratos_auditoria.js`
- `src/jobs/cleanup_orphan_contracts.js`

Mensagem sugerida:
- `feat: add contract audit flow and cabine reservation lifecycle`

### Commit 3: utilitarios locais de desenvolvimento
Escopo:
- `create_user.js`
- `test-asaas.js`

Mensagem sugerida:
- `chore: add local development utilities`

## Riscos Atuais
- `src/app.js` depende de `src/routes/analytics.js`, que ainda nao esta commitado.
- `src/server.js` depende de `src/jobs/cleanup_orphan_contracts.js`, que ainda nao esta commitado.
- As migrations `016-018` foram aplicadas localmente, mas ainda nao estao preservadas em historico git.
- Outra maquina ou outra IA pode pegar um estado inconsistente se essas pecas nao forem commitadas juntas.

## Como Continuar
1. Commitar primeiro os arquivos de analytics e dashboard consultivo.
2. Commitar em seguida o bloco de auditoria/contrato/cabines/migrations.
3. Deixar utilitarios locais em commit separado para nao misturar com feature de negocio.
4. Depois disso, revisar se `README.md` precisa ser atualizado com:
   - migrations 016-021
   - SSE de live
   - Asaas royalties
   - cleanup automatico de contratos

## Validacao Atual
- `npm test` passa.
- Recomendado apos commits:
  - `npm test`
  - smoke test de login
  - smoke test de `/v1/analytics/franqueado/resumo`
  - smoke test de `/v1/cliente/dashboard`
