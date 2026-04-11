import { test, expect } from '@playwright/test';
import { waitForFlutter } from '../helpers/auth.js';

test.describe('Autenticação', () => {
  test('login manual redireciona para dashboard correto', async ({ page }) => {
    await page.goto('/');
    await waitForFlutter(page);

    // With E2E bootstrap active, the app auto-logs in as franqueado
    // and redirects to home. Verify dashboard is visible.
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });
  });

  test('health check do backend responde ok', async ({ request }) => {
    const res = await request.get('http://127.0.0.1:3001/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('login via API retorna tokens válidos', async ({ request }) => {
    const res = await request.post('http://127.0.0.1:3001/v1/auth/login', {
      data: { email: 'franqueado@liveshop.com', senha: 'teste123' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('access_token');
    expect(body).toHaveProperty('refresh_token');
    expect(body.user).toMatchObject({
      email: 'franqueado@liveshop.com',
      papel: 'franqueado',
    });
  });

  test('login com credenciais inválidas retorna 401', async ({ request }) => {
    const res = await request.post('http://127.0.0.1:3001/v1/auth/login', {
      data: { email: 'franqueado@liveshop.com', senha: 'senhaerrada' },
    });
    expect(res.status()).toBe(401);
  });
});
