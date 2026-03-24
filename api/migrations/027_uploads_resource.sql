INSERT INTO resources (name, description)
VALUES ('uploads', 'File upload management')
ON CONFLICT (name) DO NOTHING;

WITH target_resource AS (
  SELECT id, name
  FROM resources
  WHERE name = 'uploads'
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
  AND p.code LIKE 'uploads:%'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'uploads:create'
WHERE r.name = 'staff'
ON CONFLICT DO NOTHING;
