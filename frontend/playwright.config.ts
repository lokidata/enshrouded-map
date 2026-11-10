import { defineConfig, devices } from '@playwright/test';

// Same code for the API started below and for the spec (workers inherit this environment).
process.env['SETUP_TOKEN'] ??= 'e2e-setup-token-0123';

const db = `/tmp/enshrouded-e2e-${process.pid}.db`;

// One browser per run: every run starts its own API with an empty database, and the first test creates
// the first account, which can only happen once. Firefox and WebKit run the tests tagged @cross.
const browser = (process.env['E2E_BROWSER'] ?? 'chromium') as 'chromium' | 'firefox' | 'webkit';
const engines = {
  chromium: {},
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
};

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:4200' },
  projects: [
    {
      name: browser,
      use: {
        ...engines[browser],
        ...(browser === 'chromium' && { launchOptions: { args: ['--no-sandbox'] } }),
      },
      grep: browser === 'chromium' ? undefined : /@cross/,
    },
  ],
  webServer: [
    {
      command: `cd ../backend && rm -f ${db}* && uv run alembic upgrade head && uv run uvicorn app.main:app --port 8000`,
      url: 'http://127.0.0.1:8000/api/v1/health',
      env: {
        DATABASE_URL: `sqlite:///${db}`,
        ENVIRONMENT: 'development',
        COOKIE_SECURE: 'false',
        SETUP_TOKEN: process.env['SETUP_TOKEN'],
        REGISTER_RATE_LIMIT: '1000/minute',
        LOGIN_RATE_LIMIT: '1000/minute', // one login per test
        // passkeys need a host name (not an IP): the tests open the page on localhost
        WEBAUTHN_RP_ID: 'localhost',
        WEBAUTHN_ORIGIN: 'http://localhost:4200',
      },
      reuseExistingServer: false,
    },
    {
      command: 'npx ng serve --port 4200 --host 127.0.0.1',
      url: 'http://127.0.0.1:4200',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
