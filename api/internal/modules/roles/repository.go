package roles

import (
	"context"
	"errors"
	"strings"

	"humphreys/api/internal/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	ListRoles(ctx context.Context) ([]domain.Role, error)
	CreateRole(ctx context.Context, name, description string) (domain.Role, error)
	GetRole(ctx context.Context, id string) (domain.Role, error)
	UpdateRole(ctx context.Context, id, name, description string) (domain.Role, error)
	DeleteRole(ctx context.Context, id string) error
	ReplaceRolePermissions(ctx context.Context, roleID string, permissionIDs []string) error
}

type storeRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &storeRepository{db: db}
}

func (r *storeRepository) ListRoles(ctx context.Context) ([]domain.Role, error) {
	rows, err := r.db.Query(ctx, `SELECT id, name, description, is_system FROM roles ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Role, 0)
	for rows.Next() {
		var role domain.Role
		if err := rows.Scan(&role.ID, &role.Name, &role.Description, &role.IsSystem); err != nil {
			return nil, err
		}
		perms, err := r.listPermissionsByRoleID(ctx, role.ID)
		if err != nil {
			return nil, err
		}
		role.Permissions = perms
		out = append(out, role)
	}
	return out, rows.Err()
}

func (r *storeRepository) CreateRole(ctx context.Context, name, description string) (domain.Role, error) {
	var id string
	err := r.db.QueryRow(ctx, `INSERT INTO roles(name, description, is_system) VALUES($1,$2,FALSE) RETURNING id`, name, description).Scan(&id)
	if err != nil {
		return domain.Role{}, err
	}
	return r.GetRole(ctx, id)
}

func (r *storeRepository) GetRole(ctx context.Context, id string) (domain.Role, error) {
	var role domain.Role
	err := r.db.QueryRow(ctx, `SELECT id, name, description, is_system FROM roles WHERE id=$1`, id).Scan(&role.ID, &role.Name, &role.Description, &role.IsSystem)
	if err != nil {
		return role, err
	}
	perms, err := r.listPermissionsByRoleID(ctx, id)
	if err != nil {
		return role, err
	}
	role.Permissions = perms
	return role, nil
}

func (r *storeRepository) UpdateRole(ctx context.Context, id, name, description string) (domain.Role, error) {
	_, err := r.db.Exec(ctx, `UPDATE roles SET name=$1, description=$2, updated_at=now() WHERE id=$3`, name, description, id)
	if err != nil {
		return domain.Role{}, err
	}
	return r.GetRole(ctx, id)
}

func (r *storeRepository) DeleteRole(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM roles WHERE id=$1 AND is_system=FALSE`, id)
	return err
}

func (r *storeRepository) ReplaceRolePermissions(ctx context.Context, roleID string, permissionIDs []string) error {
	var roleName string
	if err := r.db.QueryRow(ctx, `SELECT name FROM roles WHERE id=$1`, roleID).Scan(&roleName); err != nil {
		return err
	}
	if strings.EqualFold(roleName, "owner") {
		return errors.New("owner permissions cannot be changed")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM role_permissions WHERE role_id=$1`, roleID); err != nil {
		return err
	}
	for _, permissionID := range permissionIDs {
		if _, err := tx.Exec(ctx, `INSERT INTO role_permissions(role_id, permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, roleID, permissionID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *storeRepository) listPermissionsByRoleID(ctx context.Context, roleID string) ([]domain.Permission, error) {
	rows, err := r.db.Query(ctx, `
		SELECT p.id, p.code, res.name, p.action
		FROM permissions p
		JOIN resources res ON res.id = p.resource_id
		JOIN role_permissions rp ON rp.permission_id = p.id
		WHERE rp.role_id=$1
		ORDER BY p.code
	`, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Permission, 0)
	for rows.Next() {
		var permission domain.Permission
		if err := rows.Scan(&permission.ID, &permission.Code, &permission.Resource, &permission.Action); err != nil {
			return nil, err
		}
		out = append(out, permission)
	}
	return out, rows.Err()
}
