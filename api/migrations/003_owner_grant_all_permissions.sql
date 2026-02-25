-- Ensure owner role always has every permission.
-- Safe to run repeatedly.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON TRUE
WHERE r.name = 'owner'
ON CONFLICT DO NOTHING;
