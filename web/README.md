# Web (React + Vite + shadcn-style)

## Setup
1. `cp .env.example .env`
2. `npm install`
3. `npm run dev`

## Notes
- Refresh token uses HttpOnly cookie from API.
- Access token is kept in client memory in auth context.
- CSRF header is sent from `csrf_token` cookie for mutating requests.
