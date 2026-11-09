# Portfolio

This is a pnpm workspace organized around a verification loop: define expected behavior, implement it, then verify it with tests and evaluations. The API, web app, and MySQL database can run together with Docker Compose.

## Repository layout

| Path                              | Purpose                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `apps/api/`                       | TypeScript + Express API                                                              |
| `apps/webs/`                      | TypeScript + Nuxt/Vue web application                                                 |
| `packages/shared/`                | Shared TypeScript modules                                                             |
| `compose.yaml`                    | Local API, web, and MySQL services with health checks and persistent database storage |
| `.github/copilot-instructions.md` | Always-on coding-agent guidance                                                       |
| `.github/instructions/`           | Path-specific backend, frontend, and testing guidance                                 |
| `.github/agents/`                 | Role-specific implementation and review agents                                        |
| `.github/skills/`                 | On-demand backend and frontend workflows                                              |
| `docs/architecture/`              | Current system design and component boundaries                                        |
| `docs/decisions/`                 | Technical decisions, including the selected stack                                     |
| `specs/`                          | Observable requirements and acceptance criteria                                       |
| `tests/unit/`                     | Isolated Vitest checks                                                                |
| `tests/integration/`              | Cross-component Vitest checks                                                         |
| `tests/e2e/`                      | Browser user-flow checks using Playwright                                             |
| `evals/cases/`                    | Deterministic regression evaluation cases run by Vitest                               |
| `scripts/`                        | Repeatable development and verification helpers                                       |

## Selected stack

See [the stack and quality-tooling decision](docs/decisions/001-stack-and-quality-tooling.md) for runtime, framework, lint, test, and evaluation standards.

## Verification commands

Install dependencies with `pnpm install`, then run:

| Command            | Purpose                                                 |
| ------------------ | ------------------------------------------------------- |
| `pnpm dev`         | Build and start web, API, and MySQL with Docker Compose |
| `pnpm docker:up`   | Start the Compose stack in the background               |
| `pnpm docker:down` | Stop the stack (keeps the MySQL data volume)            |
| `pnpm dev:api`     | Run the API locally in watch mode                       |
| `pnpm dev:web`     | Run the Nuxt app locally                                |

Compose exposes the web app at `http://localhost:3000`, the API at `http://localhost:4000`, and MySQL at `localhost:3307`. The web UI obtains its status through a Nuxt server endpoint, so it does not need direct browser access to the API container.

Copy `.env.example` to `.env` to override local database credentials. Do not use the example or Compose fallback credentials outside local development. `pnpm docker:down` preserves database data; `docker compose down -v` deletes it.

For local development without Docker, set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` for the API, then run `pnpm dev:api`. The web app can be started separately with `pnpm dev:web`.

The verification commands are:

| Command                 | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `pnpm lint`             | ESLint across supported source and config files          |
| `pnpm format:check`     | Check formatting with Prettier                           |
| `pnpm typecheck`        | Type-check TypeScript sources and harness configs        |
| `pnpm test:unit`        | Run unit tests                                           |
| `pnpm test:integration` | Run integration tests                                    |
| `pnpm test`             | Run unit and integration tests                           |
| `pnpm eval`             | Run `*.eval.test.ts` cases in `evals/cases/`             |
| `pnpm test:e2e`         | Run Playwright tests in `tests/e2e/`                     |
| `pnpm verify`           | Run formatting, lint, type-check, tests, and evaluations |

E2E tests are separate from `pnpm verify`: `pnpm test:e2e` starts Nuxt and a deterministic API fixture. Install the Playwright browser with `pnpm exec playwright install chromium` when needed. Use the Docker Compose stack for checks against a real MySQL instance.

Vitest and Playwright intentionally fail when their target directory has no test files. `pnpm test` now has API health tests; integration, evaluation, and browser suites will fail until corresponding cases are added.

For behavior changes, update acceptance criteria, add the appropriate tests and regression evaluation, then run the narrowest checks that cover the change.
