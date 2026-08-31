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

## Install on a phone

The production build is configured as a Progressive Web App (PWA). Deploy the `web` app over HTTPS, open it in a phone browser, and choose **Add to Home Screen** (iPhone Safari) or **Install app** (Android Chrome). The PWA manifest, service worker, and app icons are generated during `npm run build`.

PWA features are generated for production builds, so use `npm run build && npm run preview` when testing locally. The API remains network-dependent; the service worker caches the application shell but does not cache private `/api/*` responses.
