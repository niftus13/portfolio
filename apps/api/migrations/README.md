# MySQL migrations

This directory is reserved for versioned, forward-only SQL migrations for the API. No migration runner or migration commands are implemented yet.

Preserve existing data and migration history. Test schema constraints, repeat runs, and failure recovery against an isolated MySQL database; never reset an existing database or volume as part of normal migration or testing. Document actual execution and recovery commands here when the runner is implemented.

See the [MVP specification](../../../specs/multitenant-mvp.md), [implementation checklist](../../../specs/multitenant-mvp-checklist.md), and [migration instructions](../../../.github/instructions/database-migrations.instructions.md).
