# Browser tests

Place Playwright browser-flow tests here as `*.spec.ts`. Run them with `pnpm test:e2e`.

Playwright starts the Nuxt app and a deterministic API health fixture automatically on ports 3000 and 4001. It fails if those ports are occupied rather than reusing unrelated services. Install Chromium with `pnpm exec playwright install chromium` and its Linux system libraries with `pnpm exec playwright install-deps chromium` when needed. Docker Compose health checks can verify service readiness, but they are not browser E2E tests against the actual API and MySQL. A real API and MySQL E2E configuration has not been implemented yet.
