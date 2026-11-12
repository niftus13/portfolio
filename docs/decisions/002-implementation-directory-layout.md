# 002: Implementation directory layout

- Status: Accepted
- Date: 2026-11-12

## Context

The MVP requires backend HTTP, domain operations, MySQL access, migrations, Nuxt screens, and an API proxy. The authentication feature now uses the chosen responsibility-based layout; other MVP feature directories are created only when needed.

## Decision

- Organize new backend feature implementation by responsibility under `apps/api/src/`: `routes/`, `controllers/`, `middleware/`, `services/`, and `repositories/`. Create each directory when it is needed rather than adding empty scaffolding. Do not require every feature to have every layer.
- Keep existing small domain helpers in place unless a related implementation needs to move them; avoid an unrelated bulk refactor. A service coordinates business operations and transactions, and a repository performs data access using the same transaction connection when required.
- Put versioned SQL migrations in `apps/api/migrations/`. Run them using the migration command documented in that directory.
- Follow Nuxt's existing `apps/webs/app/pages/` and `apps/webs/server/` structure. Add `app/components/` and `app/composables/` only as needed. Keep shared code framework-independent in `packages/shared/`.
- Apply directory-specific instructions alongside the [backend](../../.github/instructions/backend.instructions.md) and [frontend](../../.github/instructions/frontend.instructions.md) instructions. Functional policies remain in `specs/`; this decision does not resolve open API or security policies.

## Consequences

Layers clarify HTTP, business, and persistence boundaries, but a feature may span multiple directories. Avoid unnecessary layers for small operations and test behavior across the boundaries. Existing feature-named helper directories remain valid until a related change justifies moving them.
