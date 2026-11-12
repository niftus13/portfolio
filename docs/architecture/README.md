# Architecture

## Current service boundaries

- `apps/webs/` serves the Nuxt UI and proxies its same-origin `/api/health` request to the API using the server-only `NUXT_API_INTERNAL_URL` runtime setting.
- `apps/api/` serves Express health endpoints and accesses MySQL through a `mysql2` pool. The liveness endpoint does not depend on MySQL; readiness does.
- The local Compose stack runs MySQL 8.4 with a persistent named volume, the API, and the web app in that startup order. Host ports bind only to loopback.
- `packages/shared/` is reserved for framework-independent shared code; it is not yet a package.

This is a local development setup, not a production deployment or a database migration strategy. See [the stack decision](../decisions/001-stack-and-quality-tooling.md) and [the bootstrap specification](../../specs/service-bootstrap.md).

## Planned implementation layout

The [implementation layout decision](../decisions/002-implementation-directory-layout.md) defines backend responsibility layers, the migration directory, and the Nuxt application boundaries. These are conventions for future work, not a claim that the MVP layers or migration runner already exist. The [MVP checklist](../../specs/multitenant-mvp-checklist.md) tracks feature and verification status.
