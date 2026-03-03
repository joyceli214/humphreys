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

- `GET /work-orders` -> `work_orders:read`
- `GET /work-orders/customers` -> `work_orders:create` (admin-only customer search for create flow)
- `POST /work-orders` -> `work_orders:create` (admin-only create flow)
- `DELETE /work-orders/:reference_id` -> `work_orders:create` (admin-only)
- `GET /work-orders/:reference_id` -> `work_orders:read` (`work_orders_sensitive:read` controls visibility of customer/line-item/price data)
- `PATCH /work-orders/:reference_id/status` -> `work_orders_status:update`
- `PATCH /work-orders/:reference_id/equipment` -> `work_orders:update`
- `PATCH /work-orders/:reference_id/work-notes` -> `work_orders:update`
- `PATCH /work-orders/:reference_id/line-items` -> `work_orders:update`
- `PATCH /work-orders/:reference_id/totals` -> `work_orders:update`
- `PATCH /work-orders/:reference_id/customer` -> `work_orders:update`
- `GET /work-orders/:reference_id/repair-logs` -> `repair_logs:read`
- `POST /work-orders/:reference_id/repair-logs` -> `repair_logs:create`
- `PATCH /work-orders/:reference_id/repair-logs/:repair_log_id` -> `repair_logs:update`
- `DELETE /work-orders/:reference_id/repair-logs/:repair_log_id` -> `repair_logs:delete`
- `GET /work-orders/:reference_id/parts-purchase-requests` -> `parts_purchase_requests:read`
- `GET /parts-purchase-requests` -> `parts_purchase_requests:read` + `work_orders_sensitive:read` (admin-only dashboard list)
- `POST /work-orders/:reference_id/parts-purchase-requests` -> `parts_purchase_requests:create`
- `PATCH /work-orders/:reference_id/parts-purchase-requests/:parts_purchase_request_id` -> `parts_purchase_requests:update`
- `DELETE /work-orders/:reference_id/parts-purchase-requests/:parts_purchase_request_id` -> `parts_purchase_requests:delete`
