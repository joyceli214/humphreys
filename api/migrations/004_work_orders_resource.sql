INSERT INTO resources (name, description)
VALUES ('work_orders', 'Work order management')
ON CONFLICT (name) DO NOTHING;

WITH target_resource AS (
  SELECT id, name
  FROM resources
  WHERE name = 'work_orders'
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
ON CONFLICT DO NOTHING;
