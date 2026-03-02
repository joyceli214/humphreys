ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;

UPDATE public.work_orders
SET status_updated_at = COALESCE(status_updated_at, updated_at, created_at, now())
WHERE status_updated_at IS NULL;

INSERT INTO resources (name, description)
VALUES ('work_orders_status', 'Work order status updates')
ON CONFLICT (name) DO NOTHING;

WITH target_resource AS (
  SELECT id, name
  FROM resources
  WHERE name = 'work_orders_status'
), actions AS (
  SELECT unnest(ARRAY['create','read','update','delete','assign']) AS action
)
INSERT INTO permissions (resource_id, action, code)
SELECT tr.id, a.action, tr.name || ':' || a.action
FROM target_resource tr
CROSS JOIN actions a
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON TRUE
WHERE r.name IN ('owner', 'staff')
  AND p.code = 'work_orders_status:update'
ON CONFLICT DO NOTHING;
