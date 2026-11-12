# Organization and document API

This contract implements checkpoint 3 of the [MVP specification](multitenant-mvp.md). Authentication, CSRF, Origin and cookie rules follow the [authentication contract](auth-api.md).

All paths start with `/api/v1`. A signed-in user selects an organization by using its slug in subsequent paths; the slug does not grant access. Every organization request verifies an active membership. Document and version queries use the verified tenant and document IDs.

| Method and path                            | Request                                                                  | Success                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `GET /orgs`                                | none                                                                     | `200` with `{ "organizations": [{ "slug": "demo-a", "name": "Demo A", "role": "owner" }] }`; only active memberships |
| `GET /orgs/{slug}/documents`               | none                                                                     | `200` with `{ "documents": [...] }`; active documents ordered by updated time and ID descending                      |
| `POST /orgs/{slug}/documents`              | `{ "title": "Guide", "contentMd": "Text", "categoryId": null }`          | `201` with `{ "document": ... }` and an initial snapshot                                                             |
| `GET /orgs/{slug}/documents/{id}`          | none                                                                     | `200` with `{ "document": ... }`                                                                                     |
| `PATCH /orgs/{slug}/documents/{id}`        | `{ "expectedRevision": "1", "title": "Guide", "contentMd": "New text" }` | `200` with `{ "document": ... }`; changed content and its snapshot commit together                                   |
| `GET /orgs/{slug}/documents/{id}/versions` | none                                                                     | `200` with `{ "versions": [...] }`, newest version first                                                             |

Documents include `id`, `title`, `contentMd`, nullable `categoryId`, `contentVersion`, `revision`, `createdAt`, and `updatedAt`. Versions include `version`, `title`, `contentMd`, nullable `categoryId`, `changeType`, and `createdAt`. Version and revision are decimal strings, including values beyond JavaScript's safe integer range; timestamps are UTC ISO strings.

All roles may read. Only owner, admin and editor may create or update. Authenticate first; missing/inaccessible organizations and missing, deleted or cross-tenant documents return the same `404`, even when the member also lacks write permission. After finding a same-tenant document, insufficient role returns `403`. Denied same-tenant authorization is recorded separately from the rejected transaction; an audit failure is logged and the request remains denied.

Creation requires `title` and `contentMd`; omitted or null `categoryId` means no category. An update requires `expectedRevision` and at least one of `title`, `contentMd` and `categoryId`; omitted fields retain their current values and explicit null unsets a category. Reject unknown keys, incorrect types, malformed Unicode and invalid IDs with `400`. Title is trimmed and contains 1–255 Unicode code points; content is preserved exactly and may be empty. Revision is a canonical positive decimal string fitting an unsigned 64-bit integer.

After authentication, tenant-scoped lookup and authorization, check revision before no-op detection or category lookup. An outdated revision returns `409` even if submitted content matches. A valid no-op leaves revision, content version and update time unchanged. Any changed value increments both counters and creates an `update` snapshot. Creation starts both counters at `1` and creates a `create` snapshot. A category must be active and belong to the verified organization; otherwise return `404`. A counter that cannot be incremented returns `409`. A failed snapshot write rolls back its document change.

Other errors use the authentication contract's `{ "error": "..." }` shape. For example, an inaccessible resource returns `404` and `{ "error": "Not found" }`, insufficient role returns `403` and `{ "error": "Forbidden" }`, and a stale revision returns `409` and `{ "error": "Revision conflict" }`. `401` means no valid session, `403` also covers CSRF or Origin failure, `400` means invalid input, and `500` hides internal failures. State-changing requests require session-bound CSRF and the configured Origin.

Acceptance requires real MySQL tests for isolation, authorization, no-op, revision conflict, concurrent updates and snapshot rollback, plus a real browser → proxy → API → MySQL creation and update flow.
