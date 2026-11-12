# Categories and recovery API

These endpoints extend the [document API](documents-api.md) and follow the [MVP policies](multitenant-mvp.md). Authentication, CSRF, tenant isolation and error response rules remain unchanged.

| Method and path under `/api/v1/orgs/{slug}`       | Request                                                  | Result                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /categories`                                 | none                                                     | `{ "categories": [{ "id": "...", "name": "...", "deleted": false }] }`, including deleted categories |
| `POST /categories`                                | `{ "name": "Guide" }`                                    | `201` with `{ "category": ... }`                                                                     |
| `PATCH /categories/{id}`                          | `{ "name": "New name" }`                                 | `200` with `{ "category": ... }`                                                                     |
| `DELETE /categories/{id}`                         | no body                                                  | `204`; reject if any active document uses it                                                         |
| `POST /categories/{id}/restore`                   | no body                                                  | `200` with `{ "category": ... }`                                                                     |
| `DELETE /documents/{id}`                          | `{ "expectedRevision": "1" }`                            | `204`; increments revision only                                                                      |
| `GET /trash`                                      | none                                                     | `{ "documents": [...] }` with deleted documents                                                      |
| `POST /trash/{id}/restore`                        | `{ "expectedRevision": "2" }` plus optional `categoryId` | `200` with `{ "document": ... }`                                                                     |
| `POST /documents/{id}/versions/{version}/restore` | `{ "expectedRevision": "2" }` plus optional `categoryId` | `200` with `{ "document": ... }`                                                                     |

All roles may list categories. Category changes, document deletion, trash listing and trash restoration require owner or admin; version restoration requires editor or above. Resource lookup precedes role checks and does not reveal other tenants. Denials are audited separately.

Names are trimmed, contain 1–100 Unicode code points, no malformed Unicode or control characters, and use ASCII-only lowercase for uniqueness. Deleted category names remain reserved. Duplicate names and deletion of a category referenced by active documents return `409`. Deleting an already deleted category, restoring an active category or using a missing category returns `404`.

All revision and version values are canonical positive unsigned 64-bit decimal strings. Trash and historic restores preserve the original category when `categoryId` is omitted; explicit `null` unsets it. A selected category must be active and tenant-scoped. If the original or historic category is deleted, the caller must select an active category or null. Stale revision returns `409` before checking category or content. Restore of a historic version always creates a new snapshot, with `changeType` `restore` and the restored version recorded, even if content matches. Trash restore creates a `trash_restore` snapshot only if the category changes. A deleted document is not visible via normal document routes.

Each document state transition and any snapshot commit atomically. Category deletion and document association are serialized so no active document can reference a deleted category. Counter overflow returns `409`. Unsupported request fields and invalid input return `400`; invalid or inaccessible resources return `404`.
