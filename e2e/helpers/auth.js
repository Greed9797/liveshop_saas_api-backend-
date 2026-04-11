/**
 * E2E Auth Helpers
 *
 * Flutter web's FlutterSecureStorage uses localStorage with the prefix
 * "FlutterSecureStorage." (confirmed via Playwright discovery phase).
 *
 * Exact keys:
 *   FlutterSecureStorage.access_token
 *   FlutterSecureStorage.refresh_token
 *   FlutterSecureStorage.auth_user
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
    localStorage.setItem('FlutterSecureStorage.access_token', tokens.access_token);
    localStorage.setItem('FlutterSecureStorage.refresh_token', tokens.refresh_token);
    localStorage.setItem('FlutterSecureStorage.auth_user', JSON.stringify(tokens.user));
  }, data);

  await page.reload();
  await waitForFlutter(page);
}

export async function waitForFlutter(page) {
  // Wait for Flutter to finish rendering — 53+ semantics nodes = dashboard ready
  // The URL change alone is not enough; wait for network to settle + semantics to build
  await page.waitForLoadState('networkidle', { timeout: 20000 });
  await page.waitForTimeout(4000);
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
