package auth

import (
	"context"
	"strings"
	"time"

	"humphreys/api/internal/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	GetUserByEmail(ctx context.Context, email string) (DBUser, error)
	GetUserByID(ctx context.Context, id string) (domain.User, error)
	ListPermissionsByUserID(ctx context.Context, userID string) ([]domain.Permission, []string, error)
	SaveRefreshToken(ctx context.Context, userID, tokenHash, familyID string, expiresAt time.Time, createdByIP, userAgent string) (string, error)
	GetRefreshToken(ctx context.Context, tokenHash string) (RefreshTokenRecord, error)
	RevokeTokenAndSetReplacement(ctx context.Context, tokenID, replacementID string) error
	RevokeFamily(ctx context.Context, familyID string) error
	RevokeByHash(ctx context.Context, hash string) error
	MarkLastLogin(ctx context.Context, userID string) error
}

type storeRepository struct {
	db *pgxpool.Pool
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

type RefreshTokenRecord struct {
	ID                string
	UserID            string
	FamilyID          string
	ExpiresAt         time.Time
	RevokedAt         *time.Time
	ReplacedByTokenID *string
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &storeRepository{db: db}
}

func (r *storeRepository) GetUserByEmail(ctx context.Context, email string) (DBUser, error) {
	var user DBUser
	err := r.db.QueryRow(ctx, `
		SELECT id, email, password_hash, full_name, status, created_at, updated_at
		FROM users
		WHERE email=$1 AND deleted_at IS NULL
	`, strings.ToLower(email)).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.FullName, &user.Status, &user.CreatedAt, &user.UpdatedAt)
	return user, err
}

func (r *storeRepository) GetUserByID(ctx context.Context, id string) (domain.User, error) {
	var user domain.User
	err := r.db.QueryRow(ctx, `
		SELECT id, email, full_name, status, created_at, updated_at
		FROM users
		WHERE id=$1 AND deleted_at IS NULL
	`, id).Scan(&user.ID, &user.Email, &user.FullName, &user.Status, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return user, err
	}
	roles, err := r.listRolesByUserID(ctx, id)
	if err != nil {
		return user, err
	}
	user.Roles = roles
	return user, nil
}

func (r *storeRepository) ListPermissionsByUserID(ctx context.Context, userID string) ([]domain.Permission, []string, error) {
	rows, err := r.db.Query(ctx, `
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
		var permission domain.Permission
		var roleID string
		if err := rows.Scan(&permission.ID, &permission.Code, &permission.Resource, &permission.Action, &roleID); err != nil {
			return nil, nil, err
		}
		perms = append(perms, permission)
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

func (r *storeRepository) SaveRefreshToken(ctx context.Context, userID, tokenHash, familyID string, expiresAt time.Time, createdByIP, userAgent string) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO refresh_tokens(user_id, token_hash, family_id, expires_at, created_by_ip, user_agent)
		VALUES($1,$2,$3,$4,$5,$6)
		RETURNING id
	`, userID, tokenHash, familyID, expiresAt, createdByIP, userAgent).Scan(&id)
	return id, err
}

func (r *storeRepository) GetRefreshToken(ctx context.Context, tokenHash string) (RefreshTokenRecord, error) {
	var rec RefreshTokenRecord
	err := r.db.QueryRow(ctx, `
		SELECT id, user_id, family_id, expires_at, revoked_at, replaced_by_token_id
		FROM refresh_tokens
		WHERE token_hash=$1
	`, tokenHash).Scan(&rec.ID, &rec.UserID, &rec.FamilyID, &rec.ExpiresAt, &rec.RevokedAt, &rec.ReplacedByTokenID)
	return rec, err
}

func (r *storeRepository) RevokeTokenAndSetReplacement(ctx context.Context, tokenID, replacementID string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE refresh_tokens
		SET revoked_at=now(), replaced_by_token_id=$2
		WHERE id=$1 AND revoked_at IS NULL
	`, tokenID, replacementID)
	return err
}

func (r *storeRepository) RevokeFamily(ctx context.Context, familyID string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE refresh_tokens
		SET revoked_at=now()
		WHERE family_id=$1 AND revoked_at IS NULL
	`, familyID)
	return err
}

func (r *storeRepository) RevokeByHash(ctx context.Context, hash string) error {
	_, err := r.db.Exec(ctx, `UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`, hash)
	return err
}

func (r *storeRepository) MarkLastLogin(ctx context.Context, userID string) error {
	_, err := r.db.Exec(ctx, `UPDATE users SET last_login_at=now(), updated_at=now() WHERE id=$1`, userID)
	return err
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
