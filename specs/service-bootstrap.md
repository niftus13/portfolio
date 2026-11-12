# Service bootstrap and health

## Acceptance criteria

- The API production build emits `dist/index.js` and its required local modules; the compiled server can be started with the configured database environment.
- `GET /health` reports liveness independently of MySQL. `GET /health/ready` returns `200` with database status when a query succeeds and `503` without connection details when it fails.
- The Nuxt health route calls the API through its private runtime URL. The page shows readiness, reports an unavailable service, and allows a retry. The retry button is disabled until the page is interactive and while a request is pending.
- The local Compose stack starts MySQL before the API and waits for API readiness before starting the web app. Its database volume persists when the stack is stopped without `-v`.
- Browser tests start their own fixture and web server; if the required ports are occupied, they fail rather than reuse an unrelated service.

## Verification

Run `pnpm test:integration` for production build emission, `pnpm test:unit` and `pnpm eval` for API health behavior, and `pnpm test:e2e` for the browser flow against the deterministic API fixture. Validate actual container builds and MySQL connectivity separately with `docker compose up --build` and the health endpoints.
