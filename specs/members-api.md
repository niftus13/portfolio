# Membership and audit API

These endpoints follow the [MVP policies](multitenant-mvp.md) and [authentication contract](auth-api.md). All requests verify the current active membership. Only owner or admin can list members and organization audit events.

| Method and path under `/api/v1/orgs/{slug}` | Request                                    | Result                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /members`                              | none                                       | `{ "members": [{ "id": "...", "displayName": "...", "email": "...", "role": "editor", "status": "active" }] }`                                                            |
| `PATCH /members/{membershipId}`             | `{ "role": "editor", "status": "active" }` | `{ "member": ... }`                                                                                                                                                       |
| `GET /audit-events`                         | none                                       | `{ "events": [{ "id": "...", "action": "...", "targetType": "...", "targetId": "...", "actorUserId": "...", "success": true, "requestId": "...", "createdAt": "..." }] }` |

Both `role` and `status` are required for changes. Valid roles are `admin`, `editor` and `viewer`; status is `active` or `inactive`. Unknown fields and invalid values return `400`. A missing or cross-tenant member returns `404` before authorization; unauthorized changes return `403`. Owner memberships cannot be changed. An admin cannot change a current admin or assign admin, including on reactivation; owners may change admin, editor and viewer memberships. Reactivation updates the same membership and sets the requested role. Public-demo organizations reject member changes with `403` for all roles.

Successful actual changes and their audit records are committed together; if the audit write fails, the change is rolled back and the request returns `500`. A no-op is returned without creating a change audit. Denied actions are recorded separately and remain denied if recording fails; that failure is reported by the server. Audit events do not include passwords, tokens or document bodies.

Acceptance requires isolated MySQL tests for tenant boundaries, admin reactivation and assignment, demo restrictions, next-request enforcement, denied auditing, and rollback on audit failure.
