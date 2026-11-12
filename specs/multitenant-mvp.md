# Multi-tenant document MVP

Status: partially implemented. Initial migrations, one-time demo seed, authentication, tenant-scoped documents, categories, trash, version restoration and member management are implemented. Search, Markdown preview, demo reset, and their verification remain planned.

The source is the [multi-tenant MVP document](https://app.notion.com/p/4152d703a2f881b2bbacf96824d986c7). This specification records its acceptance criteria and the explicitly agreed API decisions.

## Scope

- Users can sign up and sign in. New users have no organization membership and see an organization-empty state.
- Seeded organizations have members with an `owner`, `admin`, `editor`, or `viewer` role. A user can have different roles in different organizations.
- Members can manage guides and FAQs with categories, Markdown, search, version history, and a trash.
- Organization creation, invitations, new memberships, ownership transfer, permanent deletion, attachments, and real-time collaboration are outside the MVP.

## Authentication and tenant boundaries

- Signup and login normalize email identically by trimming surrounding whitespace and lowercasing it. A duplicate signup returns `409`; login failures do not reveal whether the account exists.
- Passwords are 12–128 characters and are hashed using Node.js scrypt with an individual random salt.
- Authentication uses a server-side MySQL session identified by an opaque, host-only, HttpOnly cookie with `SameSite=Lax` and `Path=/`. Store only a hash of the session token. Set `Secure` for HTTPS; the only non-Secure exception is local HTTP development.
- Bind a pre-login CSRF token to its pre-authentication state for at most 30 minutes. On login, invalidate the pre-login token and issue a token bound to the authenticated session; the authenticated token is valid no longer than that session. Logout invalidates the session token and its CSRF token. Tokens are not rotated on every request.
- `GET /api/v1/csrf-token` returns the current token in a JSON `csrfToken` field; state-changing requests send it in the `X-CSRF-Token` header. Before authentication, bind it to a pre-authentication state identified by an HttpOnly cookie. The pre-authentication cookie must follow the same host-only, SameSite, path, and Secure rules as the session cookie. Repeated token retrieval must not invalidate an existing valid token. Token responses use `Cache-Control: no-store`.
- Protect state-changing requests with CSRF tokens and Origin validation. Require an Origin that exactly matches a configured allowed origin; reject missing or mismatched Origins. Do not derive the allowed origin from untrusted forwarded headers.
- Apply IP- and account-based rate limits to public signup and login.
- Limit login to 30 attempts per IP and 10 attempts per account in 15 minutes; limit signup to 5 attempts per IP in one hour. Return `429` and retry timing when limited without disclosing whether an account exists.
- Trust forwarded client IPs only from explicitly configured proxies. Public authentication must not start without a configured trust boundary.
- A session is invalid after 2 hours of inactivity, 24 hours since login, revocation, or user suspension. An activity update must not revive an expired session. Logout revokes the current session.
- Each organization request checks the authenticated user's active membership. A slug is not evidence of access. Tenant-owned resource queries use both the verified tenant ID and resource ID.
- Missing organizations, inaccessible organizations, and missing or other-tenant resources return the same `404` response. An authenticated member lacking a permitted role receives `403`; an unauthenticated request receives `401`.
- JSON request bodies are limited to 1 MiB (1,048,576 bytes) after decompression. Reject an oversized request with `413`; never truncate it. Specify field-level validation in the relevant API contract.

## Roles

| Action                                                  | Owner | Admin | Editor | Viewer |
| ------------------------------------------------------- | ----- | ----- | ------ | ------ |
| Read and search documents and versions                  | Yes   | Yes   | Yes    | Yes    |
| Create, edit, and restore document versions             | Yes   | Yes   | Yes    | No     |
| Delete documents, manage trash and categories           | Yes   | Yes   | No     | No     |
| Change, deactivate, or reactivate editor/viewer members | Yes   | Yes   | No     | No     |
| Assign, remove, or reactivate admin members             | Yes   | No    | No     | No     |
| Change or remove the owner                              | No    | No    | No     | No     |

Membership changes take effect on the next request. Reactivation updates the existing membership and explicitly sets its role. Public-demo restrictions are enforced by the API in addition to this table.

- An owner can reactivate an inactive admin and assign an allowed non-owner role. An admin cannot reactivate a member whose existing role is admin, including by assigning a lower role.
- An admin may reactivate an inactive editor or viewer as an editor or viewer, but cannot assign the admin role. Owner membership changes are out of scope.
- Organization member lists are available only to the organization's owner and admin.

The [membership contract](members-api.md) defines the member and organization-audit API, including input and error behavior:

| Method | Path                                         | Purpose                                                     |
| ------ | -------------------------------------------- | ----------------------------------------------------------- |
| GET    | `/api/v1/orgs/{slug}/members`                | List organization members                                   |
| PATCH  | `/api/v1/orgs/{slug}/members/{membershipId}` | Change role or deactivate/reactivate an existing membership |
| GET    | `/api/v1/orgs/{slug}/audit-events`           | Read organization audit events as owner/admin               |

## Documents and categories

- Categories are tenant-scoped and single-level. A deleted name remains reserved until the category is restored. Reject category deletion while active documents reference it.
- Category names are trimmed at both ends; their comparison keys lowercase ASCII letters only and are compared using a binary collation. Verify normalization and uniqueness using MySQL.
- Cross-tenant document/category and version/document references are rejected by both application checks and tenant-scoped database constraints.
- Documents have independent `contentVersion` and `revision` values. Creation starts both at 1 and saves an initial snapshot in the same transaction. Content changes and version restores increment both. Deletion increments only revision.
- Trash restoration without a category change increments revision and leaves content version unchanged, with no new content snapshot. Restoration with a category change increments both and creates a snapshot with `change_type` `trash_restore`.
- Changes, deletion, and restoration require `expectedRevision` as a JSON string, including a request body for DELETE. A stale revision returns `409` without overwriting the current document.
- After authentication, tenant-scoped lookup, and authorization, compare revision before checking whether an update is a no-op. A stale request returns `409` even if its proposed content matches the current content. A valid no-op preserves content version, revision, and `updated_at`.
- For PATCH, omitting `categoryId` preserves the current category; `categoryId: null` removes the association.
- Document changes and version snapshots commit atomically. Explicitly restoring an old version creates a new snapshot even when its content matches the current document. If the historic category is deleted, the user must select an active category or no category.
- Tenant-scoped lookup must not disclose a cross-tenant resource when the caller also lacks the operation's role: return `404`. The same isolation applies to lists, search, versions, and restore operations.
- Deleted documents do not appear in ordinary lists, detail, search, or version-history endpoints; ordinary detail and history return `404`. Trash operations use separate paths and permissions. A separate trash history endpoint is outside the MVP.

## Markdown preview

- Preserve the original Markdown as stored content. The preview renders headings, paragraphs and line breaks, lists, blockquotes, emphasis, inline and fenced code, and links. Do not render images or raw HTML.
- Allow `http`, `https`, and `mailto` links and same-origin relative links. Reject unsafe schemes such as `javascript:` and `data:` and do not treat a network-path reference to another origin as same-origin.

## Search

- Search titles and Markdown bodies by literal, case-sensitive substring; searching `휴가` must match `연차 및 휴가 신청` in either field. Treat `%` and `_` as literal characters, not SQL wildcards. Results are tenant-scoped and exclude deleted documents.
- Sort by `updated_at` descending, then document ID descending. Use offset pagination: `offset` is an integer at least 0, and `limit` is an integer from 1 to 100, defaulting to 20. Invalid or out-of-range values return `400`. Concurrent changes can still change page contents between requests.
- Initial-consonant search and typo correction are outside the MVP. Select an index strategy based on actual MySQL behavior and measurements without changing the expected matches.

## Demo and auditing

- Public-demo organizations enforce server-side restrictions on member role changes and removal, password and owner changes, and organization deletion.
- A trusted daily or manual reset restores only demo data and revokes only demo sessions. It must not alter ordinary organizations, users, or sessions.
- Auth and organization audit records contain no password, session token, or document body. Successful membership changes and their audit records are atomic; denied-action records must survive the rejected business transaction.
- A failed success-audit write rolls back its membership change. If a denied-action audit cannot be saved, the action remains denied and the server explicitly reports the audit failure.
- Record denied authorization and login failures separately from any rolled-back business transaction. When login failure auditing fails, keep the login denied without revealing account existence and explicitly record the audit failure in a log file. Do not send an alert for authentication audit failures.
- If successful-login audit storage fails, issue no session and return a server error. If logout auditing fails, still revoke the session and return logout success. Record either audit failure in a log file without sending an alert. If session revocation itself fails, do not report logout success.
- Organization audit access is limited to that organization's owner and admin through the API above. Authentication audit access is limited to operators in a trusted environment using a dedicated database account with read-only access to the authentication audit table. Do not commit credentials. A separate operator service or audit UI is out of scope.
- Audit records are retained for 30 days. A separate authorized operational job cleans up only expired records, independently of demo reset, and reports failures.

### Demo reset

- Explicitly designate demo-only accounts at creation; conversion between ordinary and demo accounts is outside the MVP. Demo-only accounts may have memberships only in demo organizations, and ordinary accounts may not join demo organizations. Enforce this boundary for membership and organization changes, including concurrent changes.
- Before reset, detect mixed memberships or ambiguous account types; if any are found, stop without modifying sessions or data and require operator remediation. Protect the preflight and reset from concurrent changes that would invalidate this check.
- Run at most one demo reset at a time across all demo organizations. Establish a durable gate before reset: reject new writes to the target organization and new sessions for affected demo accounts, then wait for already-running target writes and demo session issuance to finish before changing data.
- While gated, return `503` for new target writes and for affected demo logins after successful credential validation. Failed login responses must still not disclose whether an account exists. Existing ordinary sessions and ordinary organization data are not changed.
- Restore the target demo data and revoke all sessions of demo accounts associated with the target, including inactive memberships, in the same DB transaction. If an affected account also belongs to another demo organization, its sessions for that organization are revoked too. A failure rolls back the transaction, retains the gate even after process termination, and is logged and alerted; a trusted operator may safely retry the reset. Release the gate only after a successful reset.
- Reset never deletes or changes existing audit records. Audit retention cleanup remains a separate operation. An operator configures and documents the daily schedule and time zone; trusted manual execution remains available.

## Database changes

- Apply versioned SQL migrations in the forward direction. Foreign keys restrict physical deletion so that historical authors, document versions, and audit records are not silently removed.
- Migration rollback is a controlled recovery procedure rather than an automatic destructive downgrade. Never reset an existing database or volume as part of normal migration or testing.

## Verification

Use isolated real-MySQL integration tests for tenant isolation, foreign keys, sessions, authorization, transactions, concurrent revision updates, resets, and audit retention. Use browser tests for authentication and CSRF through the same-origin proxy, role-specific flows, Markdown safety, Korean search, and error/retry states. Do not treat the current health-only tests as coverage of this specification.

Before implementing a dependent feature, complete its API contract, including request/response fields and error examples not specified above. Document actual operator, reset, retention, recovery, and deployment procedures when implemented; no runner or operational command is implied by these policies.
