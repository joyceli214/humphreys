# API to Permission Mapping

- `GET /users` -> `users:read`
- `POST /users` -> `users:create`
- `GET /users/:id` -> `users:read`
- `PATCH /users/:id` -> `users:update`
- `PATCH /users/:id/status` -> `users:update`
- `PATCH /users/:id/roles` -> `users:assign`

- `GET /roles` -> `roles:read`
- `POST /roles` -> `roles:create`
- `GET /roles/:id` -> `roles:read`
- `PATCH /roles/:id` -> `roles:update`
- `DELETE /roles/:id` -> `roles:delete`
- `PATCH /roles/:id/permissions` -> `roles:assign`

- `GET /resources` -> `resources:read`
- `GET /permissions` -> `permissions:read`
