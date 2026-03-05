# Customer Web (Astro + Keystatic)

This app recreates the customer-facing Humphrey's site on Astro, with content managed in Keystatic.

## Run

1. `cd customer-web`
2. `npm install`
3. `npm run dev`
4. Open:
   - Site: `http://localhost:4321`
   - CMS: `http://localhost:4321/keystatic`

## Content

Keystatic collection:
- `pages` -> `src/content/pages/*.mdoc`

Each sitemap URL from the legacy site has a matching route.

## shadcn/ui

This app is configured for shadcn/ui (`components.json`, Tailwind setup, aliases).

Examples:
- `npx shadcn@latest add button`
- `npx shadcn@latest add card`
