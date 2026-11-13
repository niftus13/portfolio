# 001: Stack and quality tooling

- Status: Accepted
- Date: 2026-11-09

## Context

The repository is a growing application monorepo. Its directories and agent instructions identify backend, web, and shared-package boundaries, but the stack and automated verification path were not previously defined consistently.

## Decision

- Use Node.js 24 LTS (24.15 or newer) and pnpm 10.30.0 for the workspace.
- Implement `apps/api/` in TypeScript with Express 5 and MySQL 8.4 LTS. Use `mysql2` connection pools and explicit SQL; defer an ORM until domain schemas and migration requirements are known.
- Implement `apps/webs/` in TypeScript with Nuxt 4 and Vue 3. The existing `webs` directory name is retained.
- Run the web app, API, and MySQL in Docker Compose. Keep database credentials in an untracked `.env` file for local development; Compose fallback credentials are development-only.
- Use ESLint 10 with `typescript-eslint` and `eslint-plugin-vue`; use Prettier 3 for formatting.
- Use Vitest 5 for unit tests (`tests/unit/`), integration tests (`tests/integration/`), and deterministic regression evaluations (`evals/cases/*.eval.test.ts`).
- Use Playwright for browser-level tests in `tests/e2e/`.
- Keep framework runtime dependencies in the corresponding app package manifests when those apps are scaffolded. Keep shared lint, test, and type-check tooling at the workspace root.

## Verification contract

- `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` are workspace-level checks. Type checking delegates to the API's TypeScript compiler and Nuxt's type checker, then checks test and tooling configuration.
- `pnpm test` runs unit and integration tests; `pnpm eval` runs evaluation cases independently.
- `pnpm verify` runs formatting, lint, type-check, unit/integration tests, and evaluations.
- `pnpm test:e2e` is an explicit browser check. Playwright starts its own Nuxt server and API fixture on ports 3000 and 4001; Chromium and its system libraries must be installed. Occupied ports cause a failure instead of reusing another service.
- API liveness is available at `/health`; `/health/ready` checks MySQL connectivity and is used by Compose health checks.
- Keep each test runner's fail-on-no-tests behavior. A passing combined test run does not establish that each individual test category has coverage.

## Consequences

Test runner globs must use the repository's actual `apps/webs/`, `tests/`, and `evals/cases/` paths. Root checks can validate shared tooling immediately; app-specific commands and runtime dependencies are added with each app's first implementation.
