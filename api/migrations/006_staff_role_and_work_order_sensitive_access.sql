INSERT INTO resources (name, description)
VALUES ('work_orders_sensitive', 'Sensitive work order details (customer, line items, pricing)')
ON CONFLICT (name) DO NOTHING;

WITH target_resource AS (
  SELECT id, name
  FROM resources
  WHERE name = 'work_orders_sensitive'
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
WHERE r.name = 'owner'
  AND p.code LIKE 'work_orders_sensitive:%'
ON CONFLICT DO NOTHING;

INSERT INTO roles (name, description, is_system)
VALUES ('staff', 'Non-admin staff role with simplified work order access', TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON TRUE
WHERE r.name = 'staff'
  AND p.code IN (
    'work_orders:read',
    'repair_logs:create',
    'repair_logs:read',
    'repair_logs:update',
    'parts_purchase_requests:create',
    'parts_purchase_requests:read',
    'parts_purchase_requests:update'
  )
ON CONFLICT DO NOTHING;
