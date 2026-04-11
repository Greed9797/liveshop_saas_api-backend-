import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:8080',
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      // Backend API server
      command: 'node src/server.js',
      cwd: '/Users/vitormiguelgoedertdaluz/liveshop_saas_api-backend-',
      port: 3001,
      reuseExistingServer: true,
      timeout: 15000,
    },
    {
      // Flutter web static build
      command: 'npx serve build/web -l 8080 -s',
      cwd: '/Users/vitormiguelgoedertdaluz/-liveshop_saas-frontend-',
      port: 8080,
      reuseExistingServer: true,
      timeout: 10000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // SwiftShader (software WebGL) — required for CanvasKit in headless mode.
        // Without this, WebGL context is lost and Flutter crashes mid-render.
        launchOptions: {
          args: [
            '--use-gl=swiftshader',
            '--disable-gpu-sandbox',
            '--enable-webgl',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
});
