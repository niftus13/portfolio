# Integration tests

Place Vitest checks of interactions between components here as `*.test.ts` or `*.spec.ts`. Run them with `pnpm test:integration`. Make required services and setup explicit, and keep tests repeatable.

Real-MySQL tests in `mysql/` run separately with `pnpm test:integration:mysql`. Provision a dedicated MySQL 8.4 database whose name begins with `portfolio_test_`, and provide `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_USER`, `TEST_DB_PASSWORD`, and `TEST_DB_NAME`. The user must have schema and data privileges only on that isolated database. The suite applies migrations and the demo seed there, and creates and removes only its own temporary migration table; never point it at an application or shared database.

These tests cover demo/ordinary membership isolation, tenant composite foreign keys, seed idempotence, partial migration failures, authentication, and document isolation, authorization, revision conflicts, snapshots and rollback. They run test files sequentially because the migration failure test temporarily records an incomplete migration. They are not part of `pnpm test:integration` or `pnpm verify`. CI is configured to run both `pnpm verify` and the separate MySQL suite against a disposable service. Do not run another migration or browser suite against the same test database concurrently.
