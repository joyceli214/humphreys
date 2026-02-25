# Railway Setup (Config as Code)

This repo uses one Railway service for API, one for Web, and one managed PostgreSQL service.

## 1) Create services

In one Railway project, create:
- `api` service from this repo
- `web` service from this repo
- `PostgreSQL` service (managed plugin)

## 2) Point each service to config-as-code file

In each Railway service settings:
- API service config file path: `/api/railway.toml`
- Web service config file path: `/web/railway.toml`

## 3) Set required environment variables

### API service variables
- `APP_ENV=production`
- `JWT_SECRET=<strong-random-secret>`
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `OWNER_EMAIL=<owner email>`
- `OWNER_PASSWORD=<strong owner password>`
- `OWNER_FULL_NAME=Owner`
- `COOKIE_SECURE=true`
- `DB_SSLMODE=require`
- `CORS_ORIGIN=<your web service domain>`

Notes:
- `DATABASE_URL` is supported directly by the API config.
- API listens on Railway `PORT` automatically if `SERVER_ADDR` is not set.

### Web service variables
- `NEXT_PUBLIC_API_BASE_URL=<your api service domain>`

Use Railway's generated public domains, for example:
- API: `https://api-production-xxxx.up.railway.app`
- Web: `https://web-production-xxxx.up.railway.app`

Then set:
- API `CORS_ORIGIN` to web domain
- Web `NEXT_PUBLIC_API_BASE_URL` to API domain

## 4) Deploy order

Recommended:
1. Deploy Postgres service first
2. Deploy API service
3. Deploy Web service

## 5) Health checks

Configured in `railway.toml`:
- API: `/healthz`
- Web: `/`

## 5.1) Web runtime

Web service uses Vite preview in production:
- `npm run start -- --host 0.0.0.0 --port $PORT`

## 6) Notes on migrations

API runs migrations on startup (`infra/migrations`).
Make sure API has DB connectivity and valid `DATABASE_URL` before first boot.
