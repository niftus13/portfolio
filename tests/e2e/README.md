# Browser tests

Place Playwright browser-flow tests here as `*.spec.ts`. Run them with `pnpm test:e2e`.

Playwright starts the Nuxt app and a deterministic API health fixture automatically. Install Chromium with `pnpm exec playwright install chromium` when needed. For an end-to-end check against the actual API and MySQL, start `pnpm dev` separately and use the Docker Compose health checks.
