# MySQL migrations

This directory contains versioned, forward-only SQL migrations for the API. Configure the `DB_*` variables in the [API README](../README.md), then run `pnpm db:migrate` from the repository root. The command operates only on the configured database and never creates or resets it.

Migration files use the `NNN_description.sql` naming format. The runner serializes migration and seed operations per database, checks each applied file's SHA-256 checksum, and records the `applying` state before executing SQL. Files are immutable after application. A repeated successful run does not reapply them.

MySQL DDL is not transactionally rolled back. If a migration fails or the process stops, the `applying` record remains and the next run fails instead of retrying a partially applied migration. An operator must inspect the database and migration file, back up data where necessary, reconcile the partial changes with the intended schema, and only then resolve the migration record after verifying the schema. Do not delete the database or volume as a recovery shortcut. Test migrations and recovery on an isolated MySQL database first.

See the [MVP specification](../../../specs/multitenant-mvp.md) and [implementation checklist](../../../specs/multitenant-mvp-checklist.md).
