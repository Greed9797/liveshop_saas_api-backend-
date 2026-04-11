import { test, expect } from '@playwright/test';
import { waitForFlutter, E2E_USERS } from '../helpers/auth.js';

test.describe('Autenticação', () => {
  test('health check do backend responde ok', async ({ request }) => {
    const res = await request.get('http://127.0.0.1:3001/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('login via API retorna tokens válidos', async ({ request }) => {
    const res = await request.post('http://127.0.0.1:3001/v1/auth/login', {
      data: { email: E2E_USERS.franqueado.email, senha: E2E_USERS.franqueado.senha },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('access_token');
    expect(body).toHaveProperty('refresh_token');
    expect(body.user).toMatchObject({
      email: E2E_USERS.franqueado.email,
      papel: 'franqueado',
    });
  });

  test('login com credenciais inválidas retorna 401', async ({ request }) => {
    const res = await request.post('http://127.0.0.1:3001/v1/auth/login', {
      data: { email: E2E_USERS.franqueado.email, senha: 'senhaerrada' },
    });
    expect(res.status()).toBe(401);
  });

  test('login manual via form redireciona para dashboard', async ({ page }) => {
    await page.goto('/');
    await waitForFlutter(page);

    // Flutter TextField gera inputs reais com aria-label (confirmado via discovery)
    await page.locator('input[aria-label="Email"]').fill(E2E_USERS.franqueado.email);
    await page.locator('input[aria-label="Senha"]').fill(E2E_USERS.franqueado.senha);
    await page.getByRole('button', { name: 'ENTRAR' }).click();

    await waitForFlutter(page);

    // Dashboard com 50+ semantics nodes indica render completo (53 no discovery)
    const semCount = await page.evaluate(
      () => document.querySelectorAll('flt-semantics').length
    );
    expect(semCount).toBeGreaterThan(10);
  });
});
