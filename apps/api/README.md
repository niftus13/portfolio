# API

The API uses Express 5, TypeScript, and a `mysql2` connection pool.

## Local development

Run `pnpm dev:api` after setting these environment variables:

| Variable      | Required | Default     | Description     |
| ------------- | -------- | ----------- | --------------- |
| `HOST`        | No       | `127.0.0.1` | Address to bind |
| `PORT`        | No       | `4000`      | HTTP port       |
| `DB_HOST`     | No       | `127.0.0.1` | MySQL hostname  |
| `DB_PORT`     | No       | `3306`      | MySQL port      |
| `DB_USER`     | Yes      | —           | MySQL username  |
| `DB_PASSWORD` | Yes      | —           | MySQL password  |
| `DB_NAME`     | Yes      | —           | MySQL database  |

Set `HOST=0.0.0.0` when the API must be reachable outside the local process, such as from a container.

## Health endpoints

- `GET /health` reports that the HTTP process is alive.
- `GET /health/ready` executes `SELECT 1` against MySQL and returns `503` while the database is unavailable.

Run `pnpm --filter @portfolio/api build` to compile the API or `pnpm --filter @portfolio/api typecheck` to type-check it.
