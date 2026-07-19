import { defineConfig, devices } from '@playwright/test';

/**
 * E2E continuity eval. Drives the real app (ng serve) and, through the dev-only
 * window.__comicEval bridge, runs the actual comic pipeline against the actual
 * on-device model, then scores how well the story's thread survived each step.
 *
 * These runs are slow and non-deterministic (a local model does 30+ calls per
 * book), so: one worker, no retries, long timeouts. This is an eval you run
 * deliberately — not a fast CI gate.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // A full book is many sequential model calls on local hardware.
  timeout: 20 * 60 * 1000,
  expect: { timeout: 15 * 1000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/eval/playwright-report' }]],
  use: {
    baseURL: process.env.EVAL_APP_URL || 'http://localhost:4200',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start',
    url: process.env.EVAL_APP_URL || 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
  },
});
