import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(frontendRoot, '..');
const isWindows = process.platform === 'win32';
const backendPort = process.env.E2E_BACKEND_PORT ?? '18000';
const frontendPort = process.env.E2E_FRONTEND_PORT ?? '5173';
const backendBaseUrl = `http://127.0.0.1:${backendPort}`;
const frontendBaseUrl = `http://127.0.0.1:${frontendPort}`;
const reuseExistingServers = process.env.E2E_REUSE_EXISTING_SERVER === 'true' && !process.env.CI;
const pythonExecutable = isWindows
  ? (process.env.PYTHON ??
    (existsSync(path.join(repoRoot, '.venv', 'Scripts', 'python.exe'))
      ? '.\\.venv\\Scripts\\python.exe'
      : '.\\venv311\\Scripts\\python.exe'))
  : (process.env.PYTHON ?? 'python');
const backendEnv = {
  DEBUG: 'true',
  PYTHONPATH: repoRoot,
  DATABASE_URL: 'sqlite+aiosqlite:///./e2e_api_security.db',
  STARTUP_BOOTSTRAP_SCHEMA: 'true',
  STARTUP_ENABLE_DEMO_BOOTSTRAP: 'false',
  STARTUP_ENABLE_TEST_SCHEDULER: 'false',
  STARTUP_ENABLE_INGESTION_QUEUE: 'false',
  STARTUP_ENABLE_WARM_EXPORTER: 'false',
  STARTUP_ENABLE_ENDPOINT_LIFECYCLE: 'false',
  STARTUP_ENABLE_RECON_SCHEDULER: 'false',
  STARTUP_ENABLE_STREAM_PIPELINE: 'false',
  STARTUP_ENABLE_ANALYTICS_PROCESSOR: 'false',
  STARTUP_ENABLE_ARCHIVER: 'false',
  // Explicit local-loopback allow for e2e prepare/launch flows.
  // DEBUG alone must not fail-open private targets in TargetGuard.from_settings.
  PENTEST_ALLOW_PRIVATE_TARGETS: 'true',
  PENTEST_TARGET_ALLOWLIST: '127.0.0.1,localhost',
  // The frontend calls the backend cross-origin; allow whichever port it runs on
  // (CI uses a non-default one, which the built-in CORS list does not include).
  CORS_ORIGINS: JSON.stringify([frontendBaseUrl, `http://localhost:${frontendPort}`]),
};

function formatEnvForShell(env: Record<string, string>) {
  if (isWindows) {
    return Object.entries(env)
      .map(([key, value]) => `$env:${key}='${value.replace(/'/g, "''")}'`)
      .join('; ');
  }

  return Object.entries(env)
    .map(([key, value]) => `${key}='${value.replace(/'/g, "'\\''")}'`)
    .join(' ');
}

const backendCommand = isWindows
  ? `powershell -NoProfile -Command "${formatEnvForShell(backendEnv)}; ${pythonExecutable} -m uvicorn server.api.main:app --host 127.0.0.1 --port ${backendPort}"`
  : `${formatEnvForShell(backendEnv)} ${pythonExecutable} -m uvicorn server.api.main:app --host 127.0.0.1 --port ${backendPort}`;

const frontendCommand = isWindows
  ? `powershell -NoProfile -Command "${formatEnvForShell({ VITE_API_BASE_URL: backendBaseUrl })}; npm run dev -- --host 127.0.0.1 --port ${frontendPort}"`
  : `VITE_API_BASE_URL='${backendBaseUrl}' npm run dev -- --host 127.0.0.1 --port ${frontendPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: frontendBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: backendCommand,
      cwd: repoRoot,
      url: `${backendBaseUrl}/api/health/ready`,
      timeout: 120_000,
      reuseExistingServer: reuseExistingServers,
    },
    {
      command: frontendCommand,
      cwd: frontendRoot,
      url: frontendBaseUrl,
      timeout: 120_000,
      reuseExistingServer: reuseExistingServers,
    },
  ],
});
