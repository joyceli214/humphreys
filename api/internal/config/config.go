package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	AppEnv             string
	ServerAddr         string
	DatabaseURLRaw     string
	DBHost             string
	DBPort             int
	DBUser             string
	DBPassword         string
	DBName             string
	DBSSLMode          string
	JWTSecret          string
	AccessTokenTTL     time.Duration
	RefreshTokenTTL    time.Duration
	CookieSecure       bool
	CookieDomain       string
	CORSOrigin         string
	OwnerEmail         string
	OwnerPassword      string
	OwnerFullName      string
	MigrationsDir      string
}

func Load() (Config, error) {
	cfg := Config{
		AppEnv:          env("APP_ENV", "development"),
		ServerAddr:      resolveServerAddr(),
		DatabaseURLRaw:  env("DATABASE_URL", ""),
		DBHost:          env("DB_HOST", "localhost"),
		DBPort:          envInt("DB_PORT", 5432),
		DBUser:          env("DB_USER", "postgres"),
		DBPassword:      env("DB_PASSWORD", ""),
		DBName:          env("DB_NAME", "admin_panel"),
		DBSSLMode:       env("DB_SSLMODE", "disable"),
		JWTSecret:       env("JWT_SECRET", "change-me-jwt-secret"),
		AccessTokenTTL:  time.Duration(envInt("ACCESS_TOKEN_TTL_MINUTES", 15)) * time.Minute,
		RefreshTokenTTL: time.Duration(envInt("REFRESH_TOKEN_TTL_HOURS", 720)) * time.Hour,
		CookieSecure:    envBool("COOKIE_SECURE", false),
		CookieDomain:    env("COOKIE_DOMAIN", ""),
		CORSOrigin:      env("CORS_ORIGIN", "http://localhost:3000"),
		OwnerEmail:      env("OWNER_EMAIL", "owner@example.com"),
		OwnerPassword:   env("OWNER_PASSWORD", "ChangeMe123!"),
		OwnerFullName:   env("OWNER_FULL_NAME", "Owner"),
		MigrationsDir:   env("MIGRATIONS_DIR", "../infra/migrations"),
	}

	if cfg.JWTSecret == "" {
		return Config{}, fmt.Errorf("JWT_SECRET must not be empty")
	}

	return cfg, nil
}

func (c Config) DatabaseURL() string {
	if c.DatabaseURLRaw != "" {
		return c.DatabaseURLRaw
	}
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s", c.DBUser, c.DBPassword, c.DBHost, c.DBPort, c.DBName, c.DBSSLMode)
}

func resolveServerAddr() string {
	if explicit := env("SERVER_ADDR", ""); explicit != "" {
		return explicit
	}
	if port := env("PORT", ""); port != "" {
		return ":" + port
	}
	return ":8080"
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	raw := env(key, "")
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return v
}

func envBool(key string, fallback bool) bool {
	raw := env(key, "")
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}
	return v
}
