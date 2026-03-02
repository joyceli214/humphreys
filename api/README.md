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

## Highlights
- JWT access token (15m default)
- Rotating refresh token in HttpOnly cookie
- Refresh-token family revocation on reuse
- Action-based RBAC middleware
- Startup owner bootstrap from env
