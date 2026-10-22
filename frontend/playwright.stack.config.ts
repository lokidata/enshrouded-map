import { defineConfig } from '@playwright/test';

// Same tests, against the docker compose stack (deploy/): `make e2e-stack` starts it on an empty database.
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env['STACK_URL'] ?? 'http://127.0.0.1:8080',
    launchOptions: { args: ['--no-sandbox'] },
  },
});
