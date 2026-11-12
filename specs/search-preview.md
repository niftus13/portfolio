# Search and Markdown preview

The [MVP specification](multitenant-mvp.md) defines matching, access and allowed Markdown. This contract adds the following interface.

`GET /api/v1/orgs/{slug}/search?q=휴가&offset=0&limit=20` requires an active membership and returns `{ "documents": [...], "offset": 0, "limit": 20 }` using the document representation from the [document API](documents-api.md). All roles may search. `q` is required, is a nonempty string of at most 255 Unicode code points and is not trimmed or case-normalized. Reject malformed Unicode or control characters. `offset` defaults to 0 and is a canonical nonnegative integer no greater than JavaScript's maximum safe integer; `limit` defaults to 20 and must be 1–100. Reject unknown, repeated, malformed or out-of-range parameters with `400`. Inaccessible organizations return `404`.

Matching is a literal, case-sensitive substring of the stored title or Markdown body. `%` and `_` are ordinary characters. Return only non-deleted documents from the verified organization, ordered by update time and then ID descending. Pagination is offset-based, so concurrent changes may shift results. No initial-consonant matching or typo correction is provided.

The initial implementation uses a binary substring predicate and the existing tenant/listing index; arbitrary substring matching may scan the tenant's active documents. In a small isolated MySQL test database, `EXPLAIN` selected `idx_documents_listing` with an index condition and backward scan. This is not a representative performance benchmark and does not imply full-text index acceleration. Reassess with representative data before scaling.

The browser preview renders the allowed Markdown elements in the MVP without altering stored Markdown. Raw HTML and images are not rendered. Links are limited to `http`, `https`, `mailto`, and relative references that resolve to the current origin; network-path and unsafe-scheme links are not clickable. Acceptance includes real MySQL search cases and browser checks for rendered safe formatting and rejected unsafe links and HTML.
