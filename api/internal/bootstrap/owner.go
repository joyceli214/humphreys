package bootstrap

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func EnsureOwner(ctx context.Context, db *pgxpool.Pool, email, passwordHash, fullName string) error {
	if email == "" || passwordHash == "" {
		return errors.New("owner bootstrap values must not be empty")
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var ownerRoleID string
	if err := tx.QueryRow(ctx, `SELECT id FROM roles WHERE name='owner'`).Scan(&ownerRoleID); err != nil {
		return err
	}

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
