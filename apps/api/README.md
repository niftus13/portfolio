# API

The API uses Express 5, TypeScript, and a `mysql2` connection pool.

## Local development

Run `pnpm dev:api` after setting these environment variables:

| Variable                 | Required | Default     | Description                                                            |
| ------------------------ | -------- | ----------- | ---------------------------------------------------------------------- |
| `HOST`                   | No       | `127.0.0.1` | Address to bind                                                        |
| `PORT`                   | No       | `4000`      | HTTP port                                                              |
| `DB_HOST`                | No       | `127.0.0.1` | MySQL hostname                                                         |
| `DB_PORT`                | No       | `3306`      | MySQL port                                                             |
| `DB_USER`                | Yes      | —           | MySQL username                                                         |
| `DB_PASSWORD`            | Yes      | —           | MySQL password                                                         |
| `DB_NAME`                | Yes      | —           | MySQL database                                                         |
| `AUTH_ALLOWED_ORIGIN`    | Yes      | —           | Exact browser origin; HTTPS except local HTTP on localhost or loopback |
| `AUTH_TRUST_PROXY`       | Yes      | —           | Explicit trusted proxy IP/network, or `none` for direct connections    |
| `AUTH_AUDIT_FAILURE_LOG` | Yes      | —           | Absolute writable path for authentication audit failure logs           |

Set `HOST=0.0.0.0` when the API must be reachable outside the local process, such as from a container.

The API refuses to start without these authentication settings or if it cannot open the log file. The file receives JSON lines without credentials, tokens, or document bodies; no separate alert is sent. Configure file permissions, persistence and log rotation for the deployment. Compose mounts a persistent `api-logs` volume for this file.

Trust only the Nuxt proxy addresses, not arbitrary client-provided forwarded headers. The production Nuxt proxy replaces `X-Forwarded-For` with its immediate peer address. If Nuxt itself is behind another proxy, its immediate peer is the address counted by the limiter; public deployment requires a separately designed trusted upstream boundary. The Nuxt development server uses one shared loopback rate-limit bucket because it cannot reliably identify the original peer; it is not a public deployment server. Compose places Nuxt on a dedicated proxy network and trusts its configured address. Configure `AUTH_PROXY_SUBNET`, `AUTH_PROXY_IP` and `AUTH_PROXY_API_IP` together if the defaults conflict with an existing network.

Apply migrations before using authentication. Endpoints and error responses are documented in the [authentication contract](../../specs/auth-api.md), [document contract](../../specs/documents-api.md), and [recovery contract](../../specs/recovery-api.md).

Expired pre-login states, rate-limit records and sessions are not yet cleaned up automatically; audit retention and safe demo reset also remain future work. Do not expose this MVP as a public demo until these operational requirements are implemented and verified.

## Health endpoints

- `GET /health` reports that the HTTP process is alive.
- `GET /health/ready` executes `SELECT 1` against MySQL and returns `503` while the database is unavailable.

Run `pnpm --filter @portfolio/api build` to compile the API into `dist/`, then `pnpm --filter @portfolio/api start` to run it with the database environment above. Run `pnpm --filter @portfolio/api typecheck` to type-check without emitting files.

## Database setup

With the `DB_*` variables above pointing to the intended existing database, run `pnpm db:migrate` from the workspace root. See [migration safety and recovery](migrations/README.md) before applying migrations.

Set `SEED_DEMO_PASSWORD` to a password of 12–128 characters, then run `pnpm db:seed` to create two demo organizations, role-based demo accounts, and an initial document with its first version. The seed uses independently salted scrypt hashes. Do not commit the password; public deployment requires an appropriate demo password and the remaining demo restrictions and reset policy to be implemented first.

The seed is a one-time transaction. A rerun leaves existing records and passwords unchanged; it does not reset demo data. Name collisions fail the transaction instead of overwriting existing accounts or organizations. Initial seed and demo reset are separate operations; demo reset is not implemented.
