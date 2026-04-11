import { test, expect } from '@playwright/test';
import { waitForFlutter } from '../helpers/auth.js';

test.describe('Dashboard Franqueado', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForFlutter(page);
  });

  test('dashboard carrega sem erros', async ({ page }) => {
    // The app auto-logs in as franqueado via E2E bootstrap
    // 53 flt-semantics nodes confirmed in discovery = full dashboard render
    const semCount = await page.evaluate(
      () => document.querySelectorAll('flt-semantics').length
    );
    expect(semCount).toBeGreaterThan(10);
  });

  test('sidebar de navegação está visível no desktop', async ({ page }) => {
    // At 1280x800 (desktop), sidebar items exposed via flt-semantics aria-labels
    const cabinesVisible = await page.evaluate(() => {
      const nodes = document.querySelectorAll('flt-semantics[aria-label]');
      return Array.from(nodes).some(n => n.getAttribute('aria-label') === 'Cabines');
    });
    expect(cabinesVisible).toBe(true);
  });

  test('API financeiro/resumo retorna dados', async ({ request }) => {
    // Verify the endpoint the dashboard calls works
    const loginRes = await request.post('http://127.0.0.1:3001/v1/auth/login', {
      data: { email: 'franqueado@liveshop.com', senha: 'teste123' },
    });
    const { access_token } = await loginRes.json();

    const res = await request.get('http://127.0.0.1:3001/v1/financeiro/resumo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('fat_bruto');
    expect(body).toHaveProperty('fat_liquido');
    expect(body).toHaveProperty('total_custos');
  });
});
