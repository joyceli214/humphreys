# Admin Panel V1 Monorepo

Monorepo containing:
- `web/`: React + Vite admin dashboard (shadcn-style components)
- `customer-web/`: Astro + Keystatic customer-facing website
- `api/`: Go REST API with JWT access + rotating refresh token auth
- `infra/`: PostgreSQL migrations and local stack
- `openapi.yaml`: API contract source for generated TypeScript types

## Local defaults
- PostgreSQL host: `localhost`
- PostgreSQL port: `5432`
- PostgreSQL user: `postgres`
- PostgreSQL password: empty

## Quick start
1. Start Postgres:
   - `docker compose up -d db`
2. Configure env:
   - copy `api/.env.example` to `api/.env`
3. Run API:
   - for hot restart (recommended): install `air` once, then run `make api`
   - fallback without hot restart: `cd api && go run ./cmd/server`
4. Run web:
   - `cd web && npm install && npm run dev`
5. Run customer site:
   - `cd customer-web && npm install && npm run dev`

## API hot restart
- Install watcher once:
  - `go install github.com/air-verse/air@latest`
- Run:
  - `make api`
- `make api` uses `air` automatically when available, otherwise falls back to `go run ./cmd/server`.

## API auth model
- Access token: JWT (15m), returned in login/refresh response body.
- Refresh token: opaque random token in secure HttpOnly cookie (`refresh_token`), rotated on refresh.
- CSRF: mutating cookie-authenticated endpoints require matching `X-CSRF-Token` header and `csrf_token` cookie.

## Railway deployment
- Config-as-code files:
  - `api/railway.toml`
  - `web/railway.toml`
- Full guide:
  - `docs/railway-setup.md`
