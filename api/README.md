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
creation, status/total-price edits, and deletion record the actor and their name
in the same transaction. History survives request and work-order deletion.
`GET /work-orders/:reference_id/parts-purchase-requests/history` requires
`parts_purchase_requests:read`; optional `parts_purchase_request_id` filters one
request, including a deleted request. Lists and create/update responses include
`audit_flags` for approval without review and price changes after approval.
Audit recording starts with this migration; prior actions are not reconstructed.

Run PostgreSQL integration tests with
`PARTS_AUDIT_TEST_DATABASE_URL='postgres://postgres@localhost/postgres?sslmode=disable' go test ./...`.
The supplied connection must permit creating databases. Tests create and remove
an isolated database without migrating or changing the supplied database.
