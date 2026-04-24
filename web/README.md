# Web (React + Vite + shadcn-style)

## Setup
1. `cp .env.example .env`
2. `npm install`
3. `npm run dev`

## Notes
- In production, this app serves static assets and reverse-proxies `/api/*` to `API_UPSTREAM_URL`.
- Frontend API base defaults to same-origin `/api` (set `VITE_API_BASE_URL` only for local/direct API calls).
- Refresh token uses HttpOnly cookie from API.
- Access token is kept in client memory in auth context.
- CSRF header is sent from `csrf_token` cookie for mutating requests.

