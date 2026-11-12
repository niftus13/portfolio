# Authentication audit access

Organization audit events are available through the owner/admin endpoint in the [membership contract](../../specs/members-api.md). Authentication audit events are not exposed through that endpoint.

An operator connects to MySQL from a trusted environment using a dedicated account granted `SELECT` only on the application's `auth_audit_logs` table. Provision the account and its credentials through the deployment's secret-management procedure; never commit them or place passwords in shell history. Use the actual database and account names when applying the grant, and restrict account hosts according to the environment.

Before granting production access, verify using the dedicated account that reading `auth_audit_logs` succeeds and that writes and reads of other application tables fail. Operators can inspect events by time and request ID with a read-only query:

```sql
SELECT created_at, action, success, actor_user_id, request_id
FROM auth_audit_logs
ORDER BY created_at DESC
LIMIT 100;
```

Audit records and queries must not contain credentials, tokens or document contents. Retention cleanup is a separate authorized operation and is not yet implemented.
