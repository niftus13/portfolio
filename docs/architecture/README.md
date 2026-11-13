# Architecture

## Current service boundaries

- `apps/webs/` serves the Nuxt UI and proxies health and authentication requests to the API using the server-only `NUXT_API_INTERNAL_URL` setting. Its production authentication proxy forwards the immediate client address rather than trusting client-supplied forwarding headers.
- `apps/api/` serves Express health and authentication endpoints and accesses MySQL through a `mysql2` pool. Sessions and rate limits are stored in MySQL; authentication audit storage failures are recorded in an operator-configured file. The liveness endpoint does not depend on MySQL; readiness does. Explicit CLI commands apply SQL migrations and a one-time demo seed.
- The local Compose stack runs MySQL 8.4 with a persistent named volume, the API, and the web app in that startup order. A dedicated proxy network lets the API trust only the web container's configured address. Host ports bind only to loopback, and authentication failure logs have a separate persistent volume.

This is a local development setup, not a production deployment. See [migration safety](../../apps/api/migrations/README.md), [the stack decision](../decisions/001-stack-and-quality-tooling.md), and [the bootstrap specification](../../specs/service-bootstrap.md).

## Planned implementation layout

The [implementation layout decision](../decisions/002-implementation-directory-layout.md) defines backend responsibility layers, the migration directory, and the Nuxt application boundaries. Authentication uses route, service and repository layers; organization and document features remain planned. The [MVP checklist](../../specs/multitenant-mvp-checklist.md) tracks feature and verification status.
