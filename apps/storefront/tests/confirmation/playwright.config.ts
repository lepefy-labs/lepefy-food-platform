import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { localServerEnv, resolveConfirmationTarget, SMOKE_SPEC, syntheticUserAgent } from './confirmationTarget';

// Full suite: local `next start` (run `pnpm build` first), never production by default.
// Production: CONFIRMATION_SUITE=smoke PLAYWRIGHT_BASE_URL=https://shop.chloefood.com
const target = resolveConfirmationTarget(process.env);
const storefrontDir = path.resolve(__dirname, '../..');

export default defineConfig({
  testDir: '.',
  testMatch: target.suite === 'smoke' ? SMOKE_SPEC : '*.spec.ts',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: '../../confirmation-report', open: 'never' }]],
  use: {
    baseURL: target.baseURL,
    browserName: 'chromium',
    userAgent: syntheticUserAgent(devices['Desktop Chrome'].userAgent),
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: target.startLocalServer ? {
    // Node directly (no package manager on PATH needed); same `next` as `pnpm build`.
    command: `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${target.port}`,
    cwd: storefrontDir,
    url: `${target.baseURL}/accueil`,
    env: localServerEnv(process.env, target.port),
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  } : undefined,
});
