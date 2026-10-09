# API (Go + gin + PostgreSQL)

## Setup
1. `cp .env.example .env`
2. Start DB: `docker compose up -d db`
3. `go mod tidy`
4. Hot restart dev server:
   - Install once: `go install github.com/air-verse/air@latest`
   - Run: `air`
5. Fallback without watcher: `go run ./cmd/server`

Default migration directory is `./migrations` (override with `MIGRATIONS_DIR`).

For markdown image uploads to Railway Bucket (S3-compatible), set:
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET`
- `S3_USE_SSL`
- Optional: `S3_PUBLIC_BASE_URL` (if your bucket is exposed via CDN/custom domain)

For direct Outlook email sending, create a Microsoft Entra app registration with Microsoft Graph application permission `Mail.Send`, grant admin consent, then set:
- `MICROSOFT_TENANT_ID`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_SENDER_EMAIL` (the mailbox that sends customer emails)

## Highlights
- JWT access token (15m default)
- Rotating refresh token in HttpOnly cookie
- Refresh-token family revocation on reuse
- Action-based RBAC middleware
- Startup owner bootstrap from env

## Parts request audit

Migration `038_parts_purchase_request_audit.sql` adds an append-only log. Request
creation, edits to status, total price, quantity, item name, source and source URL, and deletion record the actor and their name
in the same transaction. Missing users leave a NULL name snapshot; audit actor IDs
have no foreign key to users. History survives request and work-order deletion.
`GET /work-orders/:reference_id/parts-purchase-requests/history` requires
`parts_purchase_requests:read`; optional `parts_purchase_request_id` filters one
request, including a deleted request. Lists and create/update responses include
`audit_flags` for approval without review and price changes after approval.
Audit recording starts with this migration; prior actions are not reconstructed.

Migration 038 keeps its number: when merging `feature/labour-discount`, retain
its `037_work_orders_labour_discount.sql` before this branch's 038. The migration
runner sorts filenames and tracks each one independently. These changes to 036
and 038 assume 038 has not yet been deployed; 036 can be rerun safely to backfill
existing ordered/used timestamps (without changing `updated_at`).

Approving or cancelling a waiting-approval request requires
`parts_purchase_requests:approve` in addition to update permission. Migration 038
grants approve to the owner and admin application roles; administrators can assign it to
other approvers explicitly. Sensitive-read access alone does not grant approval.
Creating a request directly as approved remains allowed and produces a warning.
A draft and its price edits produce no warning until approval; warning flags
persist even if prices are later reverted or requests are cancelled.

PATCH requests must include the `updated_at` returned by the last read. A stale
version returns 409 without changing the request or its audit; missing or invalid
versions return 400. The UI refreshes on conflict and asks the user to reopen the
request before retrying.

Run PostgreSQL integration tests with
`PARTS_AUDIT_TEST_DATABASE_URL='postgres://postgres@localhost:5432/postgres?sslmode=disable' go test ./...`.
The supplied connection must permit creating databases. Tests create and remove
an isolated database without migrating or changing the supplied database.
