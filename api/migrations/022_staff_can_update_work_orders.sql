INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'work_orders:update'
WHERE r.name = 'staff'
ON CONFLICT DO NOTHING;
