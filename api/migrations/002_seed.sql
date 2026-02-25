INSERT INTO resources (name, description)
VALUES
  ('users', 'User management'),
  ('roles', 'Role management'),
  ('permissions', 'Permission catalog'),
  ('resources', 'Resource catalog')
ON CONFLICT (name) DO NOTHING;

WITH actions AS (
  SELECT unnest(ARRAY['create','read','update','delete','assign']) AS action
), res AS (
  SELECT id, name FROM resources
)
INSERT INTO permissions (resource_id, action, code)
SELECT r.id, a.action, r.name || ':' || a.action
FROM res r
CROSS JOIN actions a
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (name, description, is_system)
VALUES ('owner', 'System owner role', TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT ro.id, p.id
FROM roles ro
JOIN permissions p ON TRUE
WHERE ro.name = 'owner'
ON CONFLICT DO NOTHING;
