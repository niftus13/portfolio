# Browser tests

Place Playwright browser-flow tests here as `*.spec.ts`. Run them with `pnpm test:e2e`.

The fixture-only `pnpm test:e2e` starts Nuxt and a deterministic API health fixture on ports 3000 and 4001. It does not test authentication against the real API or DB.

`pnpm test:e2e:auth` builds and starts the actual Nuxt app and API on ports 3002 and 4002, applies migrations to a dedicated MySQL database and verifies signup, CSRF rotation, login, logout and idle expiry through the real proxy. Provide `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_USER`, `TEST_DB_PASSWORD`, `TEST_DB_NAME` and an absolute writable `AUTH_E2E_LOG` path. The database name must start with `portfolio_test_` and the database must be dedicated to this run; do not run other tests or migrations against it concurrently. The test removes its own user, session and rate-limit data, but the audit log file remains at the configured path.

`pnpm test:e2e:documents` uses the same isolated database, environment variables and ports. It verifies organization selection, document creation and update, history, preservation of a conflicting draft, categories, recovery, member management, search and Markdown safety through the real proxy; it removes its own test records. CI runs this separately after the MySQL suite.

Both configurations fail if their ports are occupied instead of reusing unrelated services. Install Chromium with `pnpm exec playwright install chromium` and its Linux system libraries with `pnpm exec playwright install-deps chromium` when needed. Neither browser suite is included in `pnpm verify`.
