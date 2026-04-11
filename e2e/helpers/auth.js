/**
 * E2E Auth Helpers
 *
 * Flutter web's FlutterSecureStorage uses localStorage on the web.
 * These helpers login via the API and inject tokens into localStorage
 * so the Flutter app loads as authenticated.
 *
 * NOTE: The exact localStorage key names must be verified during the
 * discovery phase (Task 7) by inspecting DevTools on a running app.
 * The keys below follow Flutter's default web storage naming.
 */

export async function loginViaAPI(page, email, senha) {
  const res = await page.request.post('http://127.0.0.1:3001/v1/auth/login', {
    data: { email, senha },
  });

  if (!res.ok()) {
    throw new Error(`Login failed: ${res.status()} ${await res.text()}`);
  }

  const data = await res.json();

  await page.evaluate((tokens) => {
    localStorage.setItem('access_token', tokens.access_token);
    localStorage.setItem('refresh_token', tokens.refresh_token);
    localStorage.setItem('auth_user', JSON.stringify(tokens.user));
  }, data);

  await page.reload();
  await waitForFlutter(page);
}

export async function waitForFlutter(page) {
  // flt-glass-pane is the root element Flutter injects into the DOM
  await page.waitForSelector('flt-glass-pane', { timeout: 15000 });
  // Give Flutter time to build the widget tree and semantics overlay
  await page.waitForTimeout(3000);
}

export const E2E_USERS = {
  franqueado: {
    email: 'franqueado@liveshop.com',
    senha: 'teste123',
    role: 'franqueado',
  },
  cliente_parceiro: {
    email: 'cliente@liveshop.com',
    senha: 'teste123',
    role: 'cliente_parceiro',
  },
  franqueador_master: {
    email: 'admin@liveshop.com',
    senha: 'admin123',
    role: 'franqueador_master',
  },
};
