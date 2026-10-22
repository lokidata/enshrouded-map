import { defineConfig } from '@playwright/test';

const db = `/tmp/enshrouded-e2e-${process.pid}.db`;

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:4200', launchOptions: { args: ['--no-sandbox'] } },
  webServer: [
    {
      command: `cd ../backend && rm -f ${db}* && uv run alembic upgrade head && uv run uvicorn app.main:app --port 8000`,
      url: 'http://127.0.0.1:8000/api/v1/health',
      env: {
        DATABASE_URL: `sqlite:///${db}`,
        ENVIRONMENT: 'development',
        COOKIE_SECURE: 'false',
        REGISTER_RATE_LIMIT: '1000/minute',
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
