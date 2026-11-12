# MySQL backup and recovery

These are trusted-operator procedures for a complete database, not demo reset. A backup contains sensitive account, session, document and audit data. Store and transfer it encrypted with restricted access, use the deployment's secret-management and retention procedures, and never commit it.

## Backup

Use MySQL 8.4 client tools and an operator account authorized to read the application database. Configure connection credentials in a private MySQL client option file rather than command arguments or shell history. Freeze schema migrations and DDL during the backup; `--single-transaction` provides a consistent snapshot of InnoDB data, not a consistent snapshot across concurrent DDL. Create a new, restricted output file, and do not overwrite an existing backup:

```sh
umask 077
set -C
mysqldump --defaults-extra-file=/secure/path/client.cnf --single-transaction --no-tablespaces --set-gtid-purged=OFF DATABASE_NAME > /secure/path/new-backup.sql
```

Replace the example paths and database name with the intended values. Check the command's exit status; an unsuccessful dump must not be used, even if a partial file exists. Verify recovery into an isolated empty database before relying on the backup. Schedule the job and monitor its failures using the deployment's operational tools; this repository does not supply a scheduler or encryption service.

## Restore

Restoration overwrites tables in the destination and can discard changes and audit records newer than the backup. Obtain explicit authorization, stop all application instances and other writers, preserve the current database separately, and identify how to reconcile later data and audit records before proceeding. Never restore into a shared or production database as a test.

Create a separate empty database in an isolated MySQL 8.4 environment and restore using a dedicated authorized account:

```sh
mysql --defaults-extra-file=/secure/path/restore-client.cnf RESTORE_DATABASE_NAME < /secure/path/new-backup.sql
```

Check the exit status and validate migration state, representative tenants, documents, versions and audit records against the backup. A failed import may leave partial tables; investigate before retrying. Backups also contain sessions: before a restored database is brought online, revoke all restored sessions with an authorized account:

```sql
UPDATE sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE revoked_at IS NULL;
```

Verify that restored sessions no longer authenticate and that a fresh login works. Move traffic only after those checks and the authorized data/audit reconciliation are complete. Keep applications stopped if verification fails. Database-specific cutover, point-in-time recovery, encryption keys and backup retention are operator responsibilities and are not automated here.
