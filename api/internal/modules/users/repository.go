package users

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"humphreys/api/internal/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	ListUsers(ctx context.Context, query, status string, page, pageSize int) ([]domain.User, error)
	CreateUser(ctx context.Context, email, passwordHash, fullName, status string, roleIDs []string) (domain.User, error)
	GetUserByID(ctx context.Context, id string) (domain.User, error)
	UpdateUser(ctx context.Context, id, email, fullName string, passwordHash *string) (domain.User, error)
	SetUserStatus(ctx context.Context, id, status string) (domain.User, error)
	SetUserRoles(ctx context.Context, userID string, roleIDs []string) error
}

type storeRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &storeRepository{db: db}
}

func (r *storeRepository) ListUsers(ctx context.Context, query, status string, page, pageSize int) ([]domain.User, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	clauses := []string{"deleted_at IS NULL"}
	args := make([]any, 0)
	argPos := 1
	if query != "" {
		clauses = append(clauses, fmt.Sprintf("(email ILIKE $%d OR full_name ILIKE $%d)", argPos, argPos))
		args = append(args, "%"+query+"%")
		argPos++
	}
	if status != "" {
		clauses = append(clauses, fmt.Sprintf("status = $%d", argPos))
		args = append(args, status)
		argPos++
	}
	where := strings.Join(clauses, " AND ")
	args = append(args, pageSize, offset)

	rows, err := r.db.Query(ctx, fmt.Sprintf(`
		SELECT id, email, full_name, status, created_at, updated_at
		FROM users
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d
	`, where, argPos, argPos+1), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := make([]domain.User, 0)
	for rows.Next() {
		var u domain.User
		if err := rows.Scan(&u.ID, &u.Email, &u.FullName, &u.Status, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		roles, err := r.listRolesByUserID(ctx, u.ID)
		if err != nil {
			return nil, err
		}
		u.Roles = roles
		users = append(users, u)
	}
	return users, rows.Err()
}

func (r *storeRepository) CreateUser(ctx context.Context, email, passwordHash, fullName, status string, roleIDs []string) (domain.User, error) {
	if status == "" {
		status = "active"
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return domain.User{}, err
	}
	defer tx.Rollback(ctx)

	var id string
	if err := tx.QueryRow(ctx,
		`INSERT INTO users(email,password_hash,full_name,status) VALUES($1,$2,$3,$4) RETURNING id`,
		strings.ToLower(email), passwordHash, fullName, status,
	).Scan(&id); err != nil {
		return domain.User{}, err
	}

	if err := validateOwnerAssignment(ctx, tx, id, roleIDs); err != nil {
		return domain.User{}, err
	}

	if err := replaceUserRoles(ctx, tx, id, roleIDs); err != nil {
		return domain.User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.User{}, err
	}
	return r.GetUserByID(ctx, id)
}

func (r *storeRepository) GetUserByID(ctx context.Context, id string) (domain.User, error) {
	var u domain.User
	err := r.db.QueryRow(ctx, `
		SELECT id, email, full_name, status, created_at, updated_at
		FROM users
		WHERE id=$1 AND deleted_at IS NULL
	`, id).Scan(&u.ID, &u.Email, &u.FullName, &u.Status, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return u, err
	}
	roles, err := r.listRolesByUserID(ctx, id)
	if err != nil {
		return u, err
	}
	u.Roles = roles
	return u, nil
}

func (r *storeRepository) UpdateUser(ctx context.Context, id, email, fullName string, passwordHash *string) (domain.User, error) {
	if passwordHash == nil {
		_, err := r.db.Exec(ctx, `
			UPDATE users
			SET email=$1, full_name=$2, updated_at=now()
			WHERE id=$3 AND deleted_at IS NULL
		`, strings.ToLower(email), fullName, id)
		if err != nil {
			return domain.User{}, err
		}
	} else {
		_, err := r.db.Exec(ctx, `
			UPDATE users
			SET email=$1, full_name=$2, password_hash=$3, updated_at=now()
			WHERE id=$4 AND deleted_at IS NULL
		`, strings.ToLower(email), fullName, *passwordHash, id)
		if err != nil {
			return domain.User{}, err
		}
	}
	return r.GetUserByID(ctx, id)
}

func (r *storeRepository) SetUserStatus(ctx context.Context, id, status string) (domain.User, error) {
	if status == "deleted" {
		if _, err := r.db.Exec(ctx, `UPDATE users SET status='deleted', deleted_at=now(), updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id); err != nil {
			return domain.User{}, err
		}
	} else {
		if _, err := r.db.Exec(ctx, `UPDATE users SET status=$1, updated_at=now() WHERE id=$2 AND deleted_at IS NULL`, status, id); err != nil {
			return domain.User{}, err
		}
	}
	return r.GetUserByID(ctx, id)
}

func (r *storeRepository) SetUserRoles(ctx context.Context, userID string, roleIDs []string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := validateOwnerAssignment(ctx, tx, userID, roleIDs); err != nil {
		return err
	}

	if err := replaceUserRoles(ctx, tx, userID, roleIDs); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *storeRepository) listRolesByUserID(ctx context.Context, userID string) ([]domain.Role, error) {
	rows, err := r.db.Query(ctx, `
		SELECT r.id, r.name, r.description, r.is_system
		FROM roles r
		JOIN user_roles ur ON ur.role_id = r.id
		WHERE ur.user_id = $1
		ORDER BY r.name
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	roles := make([]domain.Role, 0)
	for rows.Next() {
		var role domain.Role
		if err := rows.Scan(&role.ID, &role.Name, &role.Description, &role.IsSystem); err != nil {
			return nil, err
		}
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

func validateOwnerAssignment(ctx context.Context, tx pgx.Tx, userID string, roleIDs []string) error {
	newHasOwner := false
	for _, roleID := range roleIDs {
		var roleName string
		if err := tx.QueryRow(ctx, `SELECT name FROM roles WHERE id=$1`, roleID).Scan(&roleName); err != nil {
			return err
		}
		if strings.EqualFold(roleName, "owner") {
			newHasOwner = true
			break
		}
	}

	var otherOwners int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM user_roles ur
		JOIN roles r ON r.id = ur.role_id
		WHERE r.name='owner' AND ur.user_id <> $1
	`, userID).Scan(&otherOwners); err != nil {
		return err
	}

	if newHasOwner && otherOwners > 0 {
		return errors.New("only one user can have owner role")
	}

	var currentHasOwner bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM user_roles ur
			JOIN roles r ON r.id = ur.role_id
			WHERE r.name='owner' AND ur.user_id = $1
		)
	`, userID).Scan(&currentHasOwner); err != nil {
		return err
	}

	if currentHasOwner && !newHasOwner && otherOwners == 0 {
		return errors.New("at least one owner is required")
	}

	return nil
}

func replaceUserRoles(ctx context.Context, tx pgx.Tx, userID string, roleIDs []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM user_roles WHERE user_id=$1`, userID); err != nil {
		return err
	}
	for _, roleID := range roleIDs {
		if _, err := tx.Exec(ctx, `INSERT INTO user_roles(user_id, role_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, userID, roleID); err != nil {
			return err
		}
	}
	return nil
}
