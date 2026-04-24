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
