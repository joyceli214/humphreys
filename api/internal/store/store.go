package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"humphreys/api/internal/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	db *pgxpool.Pool
}

func New(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

type DBUser struct {
	ID           string
	Email        string
	PasswordHash string
	FullName     string
	Status       string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func (s *Store) EnsureOwner(ctx context.Context, email, passwordHash, fullName string) error {
	if email == "" || passwordHash == "" {
		return errors.New("owner bootstrap values must not be empty")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var ownerRoleID string
	if err := tx.QueryRow(ctx, `SELECT id FROM roles WHERE name='owner'`).Scan(&ownerRoleID); err != nil {
		return err
	}

	// Keep owner role authoritative: ensure it always has all permissions.
	if _, err := tx.Exec(ctx, `
		INSERT INTO role_permissions(role_id, permission_id)
		SELECT $1, p.id
		FROM permissions p
		ON CONFLICT DO NOTHING
	`, ownerRoleID); err != nil {
		return err
	}

	var userID string
	err = tx.QueryRow(ctx, `SELECT id FROM users WHERE email=$1`, strings.ToLower(email)).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx,
			`INSERT INTO users(email, password_hash, full_name, status) VALUES($1,$2,$3,'active') RETURNING id`,
			strings.ToLower(email), passwordHash, fullName,
		).Scan(&userID)
		if err != nil {
			return err
		}
	} else if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `INSERT INTO user_roles(user_id, role_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, userID, ownerRoleID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *Store) GetUserByEmail(ctx context.Context, email string) (DBUser, error) {
	var u DBUser
	err := s.db.QueryRow(ctx, `
		SELECT id, email, password_hash, full_name, status, created_at, updated_at
		FROM users
		WHERE email=$1 AND deleted_at IS NULL
	`, strings.ToLower(email)).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.FullName, &u.Status, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}

func (s *Store) GetUserByID(ctx context.Context, id string) (domain.User, error) {
	var u domain.User
	err := s.db.QueryRow(ctx, `
		SELECT id, email, full_name, status, created_at, updated_at
		FROM users
		WHERE id=$1 AND deleted_at IS NULL
	`, id).Scan(&u.ID, &u.Email, &u.FullName, &u.Status, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return u, err
	}
	roles, err := s.ListRolesByUserID(ctx, id)
	if err != nil {
		return u, err
	}
	u.Roles = roles
	return u, nil
}

func (s *Store) ListUsers(ctx context.Context, query, status string, page, pageSize int) ([]domain.User, error) {
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

	rows, err := s.db.Query(ctx, fmt.Sprintf(`
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
		roles, err := s.ListRolesByUserID(ctx, u.ID)
		if err != nil {
			return nil, err
		}
		u.Roles = roles
		users = append(users, u)
	}
	return users, rows.Err()
}

func (s *Store) CreateUser(ctx context.Context, email, passwordHash, fullName, status string, roleIDs []string) (domain.User, error) {
	if status == "" {
		status = "active"
	}
	tx, err := s.db.Begin(ctx)
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
	return s.GetUserByID(ctx, id)
}

func (s *Store) UpdateUser(ctx context.Context, id, email, fullName string, passwordHash *string) (domain.User, error) {
	if passwordHash == nil {
		_, err := s.db.Exec(ctx, `
			UPDATE users
			SET email=$1, full_name=$2, updated_at=now()
			WHERE id=$3 AND deleted_at IS NULL
		`, strings.ToLower(email), fullName, id)
		if err != nil {
			return domain.User{}, err
		}
	} else {
		_, err := s.db.Exec(ctx, `
			UPDATE users
			SET email=$1, full_name=$2, password_hash=$3, updated_at=now()
			WHERE id=$4 AND deleted_at IS NULL
		`, strings.ToLower(email), fullName, *passwordHash, id)
		if err != nil {
			return domain.User{}, err
		}
	}
	return s.GetUserByID(ctx, id)
}

func (s *Store) SetUserStatus(ctx context.Context, id, status string) (domain.User, error) {
	if status == "deleted" {
		if _, err := s.db.Exec(ctx, `UPDATE users SET status='deleted', deleted_at=now(), updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id); err != nil {
			return domain.User{}, err
		}
	} else {
		if _, err := s.db.Exec(ctx, `UPDATE users SET status=$1, updated_at=now() WHERE id=$2 AND deleted_at IS NULL`, status, id); err != nil {
			return domain.User{}, err
		}
	}
	return s.GetUserByID(ctx, id)
}

func (s *Store) SetUserRoles(ctx context.Context, userID string, roleIDs []string) error {
	tx, err := s.db.Begin(ctx)
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

func (s *Store) ListRolesByUserID(ctx context.Context, userID string) ([]domain.Role, error) {
	rows, err := s.db.Query(ctx, `
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
		var r domain.Role
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &r.IsSystem); err != nil {
			return nil, err
		}
		roles = append(roles, r)
	}
	return roles, rows.Err()
}

func (s *Store) ListPermissionsByUserID(ctx context.Context, userID string) ([]domain.Permission, []string, error) {
	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT p.id, p.code, res.name, p.action, r.id
		FROM permissions p
		JOIN resources res ON res.id = p.resource_id
		JOIN role_permissions rp ON rp.permission_id = p.id
		JOIN roles r ON r.id = rp.role_id
		JOIN user_roles ur ON ur.role_id = r.id
		WHERE ur.user_id = $1
		ORDER BY p.code
	`, userID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	perms := make([]domain.Permission, 0)
	roleSet := map[string]struct{}{}
	for rows.Next() {
		var p domain.Permission
		var roleID string
		if err := rows.Scan(&p.ID, &p.Code, &p.Resource, &p.Action, &roleID); err != nil {
			return nil, nil, err
		}
		perms = append(perms, p)
		roleSet[roleID] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	roleIDs := make([]string, 0, len(roleSet))
	for roleID := range roleSet {
		roleIDs = append(roleIDs, roleID)
	}
	return perms, roleIDs, nil
}

func (s *Store) SaveRefreshToken(ctx context.Context, userID, tokenHash, familyID string, expiresAt time.Time, createdByIP, userAgent string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx, `
		INSERT INTO refresh_tokens(user_id, token_hash, family_id, expires_at, created_by_ip, user_agent)
		VALUES($1,$2,$3,$4,$5,$6)
		RETURNING id
	`, userID, tokenHash, familyID, expiresAt, createdByIP, userAgent).Scan(&id)
	return id, err
}

type RefreshTokenRecord struct {
	ID                string
	UserID            string
	FamilyID          string
	ExpiresAt         time.Time
	RevokedAt         *time.Time
	ReplacedByTokenID *string
}

func (s *Store) GetRefreshToken(ctx context.Context, tokenHash string) (RefreshTokenRecord, error) {
	var rec RefreshTokenRecord
	err := s.db.QueryRow(ctx, `
		SELECT id, user_id, family_id, expires_at, revoked_at, replaced_by_token_id
		FROM refresh_tokens
		WHERE token_hash=$1
	`, tokenHash).Scan(&rec.ID, &rec.UserID, &rec.FamilyID, &rec.ExpiresAt, &rec.RevokedAt, &rec.ReplacedByTokenID)
	return rec, err
}

func (s *Store) RevokeTokenAndSetReplacement(ctx context.Context, tokenID, replacementID string) error {
	_, err := s.db.Exec(ctx, `
		UPDATE refresh_tokens
		SET revoked_at=now(), replaced_by_token_id=$2
		WHERE id=$1 AND revoked_at IS NULL
	`, tokenID, replacementID)
	return err
}

func (s *Store) RevokeFamily(ctx context.Context, familyID string) error {
	_, err := s.db.Exec(ctx, `
		UPDATE refresh_tokens
		SET revoked_at=now()
		WHERE family_id=$1 AND revoked_at IS NULL
	`, familyID)
	return err
}

func (s *Store) RevokeByHash(ctx context.Context, hash string) error {
	_, err := s.db.Exec(ctx, `UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`, hash)
	return err
}

func (s *Store) MarkLastLogin(ctx context.Context, userID string) error {
	_, err := s.db.Exec(ctx, `UPDATE users SET last_login_at=now(), updated_at=now() WHERE id=$1`, userID)
	return err
}

func (s *Store) ListRoles(ctx context.Context) ([]domain.Role, error) {
	rows, err := s.db.Query(ctx, `SELECT id, name, description, is_system FROM roles ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Role, 0)
	for rows.Next() {
		var r domain.Role
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &r.IsSystem); err != nil {
			return nil, err
		}
		perms, err := s.ListPermissionsByRoleID(ctx, r.ID)
		if err != nil {
			return nil, err
		}
		r.Permissions = perms
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) GetRole(ctx context.Context, id string) (domain.Role, error) {
	var r domain.Role
	err := s.db.QueryRow(ctx, `SELECT id, name, description, is_system FROM roles WHERE id=$1`, id).Scan(&r.ID, &r.Name, &r.Description, &r.IsSystem)
	if err != nil {
		return r, err
	}
	perms, err := s.ListPermissionsByRoleID(ctx, id)
	if err != nil {
		return r, err
	}
	r.Permissions = perms
	return r, nil
}

func (s *Store) CreateRole(ctx context.Context, name, description string) (domain.Role, error) {
	var id string
	err := s.db.QueryRow(ctx, `INSERT INTO roles(name, description, is_system) VALUES($1,$2,FALSE) RETURNING id`, name, description).Scan(&id)
	if err != nil {
		return domain.Role{}, err
	}
	return s.GetRole(ctx, id)
}

func (s *Store) UpdateRole(ctx context.Context, id, name, description string) (domain.Role, error) {
	_, err := s.db.Exec(ctx, `UPDATE roles SET name=$1, description=$2, updated_at=now() WHERE id=$3`, name, description, id)
	if err != nil {
		return domain.Role{}, err
	}
	return s.GetRole(ctx, id)
}

func (s *Store) DeleteRole(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM roles WHERE id=$1 AND is_system=FALSE`, id)
	return err
}

func (s *Store) ReplaceRolePermissions(ctx context.Context, roleID string, permissionIDs []string) error {
	var roleName string
	if err := s.db.QueryRow(ctx, `SELECT name FROM roles WHERE id=$1`, roleID).Scan(&roleName); err != nil {
		return err
	}
	if strings.EqualFold(roleName, "owner") {
		return errors.New("owner permissions cannot be changed")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM role_permissions WHERE role_id=$1`, roleID); err != nil {
		return err
	}
	for _, pid := range permissionIDs {
		if _, err := tx.Exec(ctx, `INSERT INTO role_permissions(role_id, permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, roleID, pid); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) ListPermissionsByRoleID(ctx context.Context, roleID string) ([]domain.Permission, error) {
	rows, err := s.db.Query(ctx, `
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
		var p domain.Permission
		if err := rows.Scan(&p.ID, &p.Code, &p.Resource, &p.Action); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) ListResources(ctx context.Context) ([]domain.Resource, error) {
	rows, err := s.db.Query(ctx, `SELECT id, name, description FROM resources ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Resource, 0)
	for rows.Next() {
		var r domain.Resource
		if err := rows.Scan(&r.ID, &r.Name, &r.Description); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) ListPermissions(ctx context.Context) ([]domain.Permission, error) {
	rows, err := s.db.Query(ctx, `
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
		var p domain.Permission
		if err := rows.Scan(&p.ID, &p.Code, &p.Resource, &p.Action); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func NewUUID() string {
	return uuid.NewString()
}
