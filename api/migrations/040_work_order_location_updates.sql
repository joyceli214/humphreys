INSERT INTO resources (name, description)
VALUES ('work_orders_location', 'Work order location updates')
ON CONFLICT (name) DO NOTHING;

WITH target_resource AS (
  SELECT id, name
  FROM resources
  WHERE name = 'work_orders_location'
), actions AS (
  SELECT unnest(ARRAY['create','read','update','delete','assign']) AS action
)
INSERT INTO permissions (resource_id, action, code)
SELECT tr.id, a.action, tr.name || ':' || a.action
FROM target_resource tr
CROSS JOIN actions a
ON CONFLICT (code) DO NOTHING;

-- Grant work_orders_location:update to the staff role and to every role that
-- already holds the broad work_orders:update permission (owner/admin).
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'work_orders_location:update'
WHERE r.name = 'staff'
  OR r.id IN (
    SELECT rp.role_id
    FROM role_permissions rp
    JOIN permissions wu ON wu.id = rp.permission_id
    WHERE wu.code = 'work_orders:update'
  )
ON CONFLICT DO NOTHING;
