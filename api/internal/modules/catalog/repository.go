package catalog

import (
	"context"

	"humphreys/api/internal/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	ListResources(ctx context.Context) ([]domain.Resource, error)
	ListPermissions(ctx context.Context) ([]domain.Permission, error)
}

type storeRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &storeRepository{db: db}
}

func (r *storeRepository) ListResources(ctx context.Context) ([]domain.Resource, error) {
	rows, err := r.db.Query(ctx, `SELECT id, name, description FROM resources ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Resource, 0)
	for rows.Next() {
		var resource domain.Resource
		if err := rows.Scan(&resource.ID, &resource.Name, &resource.Description); err != nil {
			return nil, err
		}
		out = append(out, resource)
	}
	return out, rows.Err()
}

func (r *storeRepository) ListPermissions(ctx context.Context) ([]domain.Permission, error) {
	rows, err := r.db.Query(ctx, `
		SELECT p.id, p.code, res.name, p.action
		FROM permissions p
		JOIN resources res ON res.id = p.resource_id
		ORDER BY p.code
	`)
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
