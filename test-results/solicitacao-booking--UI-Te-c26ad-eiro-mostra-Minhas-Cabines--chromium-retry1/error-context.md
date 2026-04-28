# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: solicitacao-booking.spec.js >> [UI] Tela Minhas Cabines e Solicitações >> Sidebar de cliente_parceiro mostra "Minhas Cabines"
- Location: e2e/tests/solicitacao-booking.spec.js:329:3

# Error details

```
Error: Sidebar deve mostrar "Minhas Cabines" para cliente_parceiro

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  235 | 
  236 |   test('Validação: data_solicitada no passado retorna 400', async ({ request }) => {
  237 |     if (!cabineId) test.skip();
  238 |     const res = await request.post(`http://127.0.0.1:3001/v1/cliente/cabines/${cabineId}/solicitar-live`, {
  239 |       headers: { Authorization: `Bearer ${clienteToken}` },
  240 |       data: {
  241 |         data_solicitada: '2020-01-01', // Passado
  242 |         hora_inicio: '10:00',
  243 |         hora_fim: '12:00',
  244 |       },
  245 |     });
  246 |     expect(res.status()).toBeGreaterThanOrEqual(400);
  247 |     expect(res.status()).toBeLessThan(500);
  248 |   });
  249 | 
  250 |   test('Overlap: aprovar dois pedidos no mesmo horário deve retornar 409', async ({ request }) => {
  251 |     if (!cabineId) test.skip();
  252 |     // Use unique far-future date (+10 days offset) distinct from other tests in this describe
  253 |     const data = farFutureDateStr(10);
  254 | 
  255 |     // Criar duas solicitações sobrepostas
  256 |     const [r1, r2] = await Promise.all([
  257 |       request.post(`http://127.0.0.1:3001/v1/cliente/cabines/${cabineId}/solicitar-live`, {
  258 |         headers: { Authorization: `Bearer ${clienteToken}` },
  259 |         data: { data_solicitada: data, hora_inicio: '09:00', hora_fim: '11:00' },
  260 |       }),
  261 |       request.post(`http://127.0.0.1:3001/v1/cliente/cabines/${cabineId}/solicitar-live`, {
  262 |         headers: { Authorization: `Bearer ${clienteToken}` },
  263 |         data: { data_solicitada: data, hora_inicio: '10:00', hora_fim: '12:00' }, // Overlap
  264 |       }),
  265 |     ]);
  266 | 
  267 |     if (!r1.ok() || !r2.ok()) {
  268 |       test.skip(); // Sem cabine disponível para testar
  269 |       return;
  270 |     }
  271 | 
  272 |     const { id: id1 } = await r1.json();
  273 |     const { id: id2 } = await r2.json();
  274 |     sol1Id = id1;
  275 |     sol2Id = id2;
  276 | 
  277 |     // Aprovar a primeira
  278 |     const a1 = await request.patch(`http://127.0.0.1:3001/v1/solicitacoes/${id1}/aprovar`, {
  279 |       headers: { Authorization: `Bearer ${franqueadoToken}` },
  280 |     });
  281 |     expect(a1.ok(), `Aprovação da 1ª solicitação falhou: ${await a1.text()}`).toBeTruthy();
  282 | 
  283 |     // Aprovar a segunda (overlap) — deve retornar 409
  284 |     const a2 = await request.patch(`http://127.0.0.1:3001/v1/solicitacoes/${id2}/aprovar`, {
  285 |       headers: { Authorization: `Bearer ${franqueadoToken}` },
  286 |     });
  287 |     expect(a2.status(), 'Aprovação com overlap deve retornar 409').toBe(409);
  288 |   });
  289 | 
  290 |   test('Recusar: motivo obrigatório — sem motivo retorna 400', async ({ request }) => {
  291 |     if (!cabineId) test.skip();
  292 |     const criarRes = await request.post(`http://127.0.0.1:3001/v1/cliente/cabines/${cabineId}/solicitar-live`, {
  293 |       headers: { Authorization: `Bearer ${clienteToken}` },
  294 |       data: { data_solicitada: farFutureDateStr(15), hora_inicio: '20:00', hora_fim: '22:00' },
  295 |     });
  296 |     if (!criarRes.ok()) test.skip();
  297 |     const { id } = await criarRes.json();
  298 | 
  299 |     const recusarRes = await request.patch(`http://127.0.0.1:3001/v1/solicitacoes/${id}/recusar`, {
  300 |       headers: { Authorization: `Bearer ${franqueadoToken}` },
  301 |       data: {}, // motivo_recusa ausente
  302 |     });
  303 |     expect(recusarRes.status()).toBeGreaterThanOrEqual(400);
  304 |     expect(recusarRes.status()).toBeLessThan(500);
  305 |   });
  306 | 
  307 |   test('Sem autenticação: POST solicitar-live retorna 401', async ({ request }) => {
  308 |     const dummyId = '00000000-0000-0000-0000-000000000001';
  309 |     const res = await request.post(`http://127.0.0.1:3001/v1/cliente/cabines/${dummyId}/solicitar-live`, {
  310 |       data: { data_solicitada: tomorrowDateStr(), hora_inicio: '10:00', hora_fim: '12:00' },
  311 |     });
  312 |     expect(res.status()).toBe(401);
  313 |   });
  314 | });
  315 | 
  316 | // ── Testes de UI (Flutter Web via flt-semantics) ───────────────────────────────
  317 | 
  318 | test.describe('[UI] Tela Minhas Cabines e Solicitações', () => {
  319 |   // UI tests include Flutter startup + form login + screen render — needs more time
  320 |   test.setTimeout(60000);
  321 | 
  322 |   test.beforeEach(async ({ page }) => {
  323 |     await page.goto('/');
  324 |     // Wait for the login screen to be ready (networkidle means Flutter bootstrap finished)
  325 |     await page.waitForLoadState('networkidle', { timeout: 20000 });
  326 |     await page.waitForTimeout(2000);
  327 |   });
  328 | 
  329 |   test('Sidebar de cliente_parceiro mostra "Minhas Cabines"', async ({ page }) => {
  330 |     // loginViaAPI fills the form and waits for dashboard (networkidle + 4s)
  331 |     await loginViaAPI(page, E2E_USERS.demo_cliente.email, E2E_USERS.demo_cliente.senha)
  332 |       .catch(() => loginViaAPI(page, E2E_USERS.cliente_parceiro.email, E2E_USERS.cliente_parceiro.senha));
  333 | 
  334 |     const hasCabines = await hasSemanticsNode(page, 'button', 'Minhas Cabines');
> 335 |     expect(hasCabines, 'Sidebar deve mostrar "Minhas Cabines" para cliente_parceiro').toBe(true);
      |                                                                                       ^ Error: Sidebar deve mostrar "Minhas Cabines" para cliente_parceiro
  336 |   });
  337 | 
  338 |   test('Tela Minhas Cabines carrega sem erros', async ({ page }) => {
  339 |     await loginViaAPI(page, E2E_USERS.demo_cliente.email, E2E_USERS.demo_cliente.senha)
  340 |       .catch(() => loginViaAPI(page, E2E_USERS.cliente_parceiro.email, E2E_USERS.cliente_parceiro.senha));
  341 | 
  342 |     await clickSidebarItem(page, 'Minhas Cabines');
  343 | 
  344 |     const nodeCount = await countSemanticsNodes(page);
  345 |     expect(nodeCount, 'Tela Minhas Cabines deve ter semantics nodes renderizados').toBeGreaterThan(5);
  346 | 
  347 |     const hasError = await hasErrorState(page);
  348 |     expect(hasError, 'Não deve haver estado de erro na tela').toBe(false);
  349 |   });
  350 | 
  351 |   test('Sidebar de franqueado mostra "Solicitações"', async ({ page }) => {
  352 |     await loginViaAPI(page, E2E_USERS.franqueado.email, E2E_USERS.franqueado.senha);
  353 | 
  354 |     const hasSolicitacoes = await hasSemanticsNode(page, 'button', 'Solicitações');
  355 |     expect(hasSolicitacoes, 'Sidebar deve mostrar "Solicitações" para franqueado').toBe(true);
  356 |   });
  357 | 
  358 |   test('Tela Solicitações carrega e mostra abas Pendentes/Todas', async ({ page }) => {
  359 |     await loginViaAPI(page, E2E_USERS.franqueado.email, E2E_USERS.franqueado.senha);
  360 | 
  361 |     await clickSidebarItem(page, 'Solicitações');
  362 |     const nodeCount = await waitForScreenWithNodes(page, 5, 15000);
  363 |     expect(nodeCount, 'Tela Solicitações deve ter semantics nodes').toBeGreaterThanOrEqual(5);
  364 | 
  365 |     // Tabs may render as role="tab" or role="button"; label may be uppercase in Flutter
  366 |     // Accept any case variant of Pendentes/Todas/Aprovadas/Recusadas/Solicitações
  367 |     const hasAbaContent = await page.evaluate(() => {
  368 |       const texts = Array.from(document.querySelectorAll('flt-semantics'))
  369 |         .map(n => (n.textContent || '').trim().toLowerCase());
  370 |       const keywords = ['pendentes', 'todas', 'aprovadas', 'recusadas', 'solicitações', 'solicitacoes'];
  371 |       return texts.some(t => keywords.some(k => t.includes(k)));
  372 |     });
  373 |     expect(hasAbaContent, 'Tela Solicitações deve mostrar abas ou título da tela').toBe(true);
  374 | 
  375 |     const hasError = await hasErrorState(page);
  376 |     expect(hasError, 'Não deve haver estado de erro na tela Solicitações').toBe(false);
  377 |   });
  378 | });
  379 | 
```