# Architecture

- `web`: Next.js app router dashboard for admin operations.
- `api`: Go service with PostgreSQL-backed auth and RBAC.
- `infra`: SQL migrations for schema + idempotent seed.
- `openapi.yaml`: Contract source used to generate TS API types.

Auth uses short-lived JWT access tokens and rotating opaque refresh tokens with reuse detection.
