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
- `PATCH /work-orders/:reference_id/location` -> `work_orders_location:update` or `work_orders:update` (location-only; body accepts only `location_id`)
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

- `POST /ai-tools/mass-update/preview` -> `work_orders:update` (owner/admin; LLM proposes, nothing written)
- `POST /ai-tools/mass-update/apply` -> `work_orders:update` (owner/admin; re-validates every op server-side)
- `POST /ai-tools/search/interpret` -> `work_orders:update` (owner/admin; LLM sees only the question + status names, returns validated filters, never executes)
- `POST /ai-tools/search` -> `work_orders:update` (owner/admin; whitelisted filters, parameterized SQL, customer name only, no email/phone)
- `GET /ai-tools/job-summary/stale` -> `work_orders:update` (owner/admin; customer name only, no email/phone; not shown in AI Tools UI, kept for dashboard reuse)
- `POST /ai-tools/job-summary` -> `work_orders:update` (owner/admin; customer name only, no email/phone; not shown in AI Tools UI, kept for dashboard reuse)
- `POST /ai-tools/email-draft` -> `work_orders:update` (owner/admin; drafts only, never sends). Accepts `work_order_id` (legacy) or `work_order_ids` (1..10 jobs, same customer; mixed customers -> 400). Returns only a masked `recipient_hint` (e.g. `j***@gmail.com`) and `has_recipient_email`, never the full address. The AI Tools tab sends through `POST /work-orders/:reference_id/customer-email` with an empty `to`, so the recipient is looked up from the customer record server-side.
