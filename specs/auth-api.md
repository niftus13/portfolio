# Authentication API contract

This contract implements the authentication policies in [the MVP specification](multitenant-mvp.md). Implementation and verification status is recorded in the [checklist](multitenant-mvp-checklist.md).

All paths are relative to the browser's same origin and are proxied to the API. JSON responses use `Cache-Control: no-store`. State-changing requests require the exact configured Origin and the `X-CSRF-Token` header. The API does not expose internal errors. Error responses are JSON objects with an `error` string.

| Method and path            | Request                                                       | Success                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/csrf-token`   | Existing cookies, if any                                      | `200` with `{ "csrfToken": "..." }`; creates or reuses pre-login state, or returns the current session token                                                           |
| `POST /api/v1/auth/signup` | `{ "email": "...", "password": "...", "displayName": "..." }` | `201` with `{ "id": "..." }`; does not sign in or create a membership                                                                                                  |
| `POST /api/v1/auth/login`  | `{ "email": "...", "password": "..." }`                       | `200` with `{ "user": { "id": "...", "email": "...", "displayName": "..." }, "csrfToken": "...", "hasOrganizations": false }`; replaces pre-login state with a session |
| `GET /api/v1/auth/me`      | Session cookie                                                | `200` with `{ "user": { "id": "...", "email": "...", "displayName": "..." }, "hasOrganizations": false }`                                                              |
| `POST /api/v1/auth/logout` | Session cookie and session CSRF token                         | `204`; revokes the current session                                                                                                                                     |

Email is trimmed and lowercased, must have a nonempty local part and domain separated by `@`, contain no whitespace, and fit in 255 Unicode code points. The password must have 12–128 Unicode code points. Display name is trimmed and must have 1–100 Unicode code points. Reject malformed Unicode in these fields and ASCII control characters in email and display name. Unknown fields and incorrect JSON types are rejected.

Invalid input returns `400`, absent or expired session and invalid credentials return `401`, CSRF or Origin failure returns `403`, duplicate signup returns `409`, oversized JSON returns `413`, and rate limiting returns `429` with `Retry-After` seconds. Authentication failures use the same response for unknown, suspended and incorrect-password accounts. Infrastructure failures return `500` without internal details.

`hasOrganizations` is true only when the user has at least one active membership. Attempting login while already signed in returns `409`.

The pre-login `portfolio_preauth` and authenticated `portfolio_session` cookies are host-only, HttpOnly, SameSite=Lax and Path=/. Cookies are Secure for HTTPS; the only non-Secure exception is local HTTP. The Nuxt proxy passes these cookies, Origin and CSRF headers and replaces the forwarded IP with its immediate peer. Authentication audit write failures are recorded in an operator-configured log file without secrets or a separate alert. Logout succeeds only if session revocation succeeds; login succeeds only if its success audit and session creation both commit. Failure to write the log file must also be reported to standard error.

Acceptance requires real MySQL tests for the specified security and failure paths, and a real-browser flow through the Nuxt proxy, API and MySQL. The fixture-only health test is not evidence for this contract.
