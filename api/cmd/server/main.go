package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"humphreys/api/internal/bootstrap"
	"humphreys/api/internal/config"
	"humphreys/api/internal/db"
	"humphreys/api/internal/middleware"
	"humphreys/api/internal/modules/auth"
	authsecurity "humphreys/api/internal/modules/auth/security"
	"humphreys/api/internal/modules/catalog"
	"humphreys/api/internal/modules/roles"
	"humphreys/api/internal/modules/users"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := db.Connect(ctx, cfg.DatabaseURL())
	if err != nil {
		log.Fatalf("db connect error: %v", err)
	}
	defer pool.Close()

	if err := db.RunMigrations(ctx, pool, cfg.MigrationsDir); err != nil {
		log.Fatalf("migrations failed: %v", err)
	}

	ownerHash, err := authsecurity.HashPassword(cfg.OwnerPassword)
	if err != nil {
		log.Fatalf("owner password hash failed: %v", err)
	}
	if err := bootstrap.EnsureOwner(ctx, pool, cfg.OwnerEmail, ownerHash, cfg.OwnerFullName); err != nil {
		log.Fatalf("owner bootstrap failed: %v", err)
	}

	authHandler := auth.New(pool, cfg)
	usersHandler := users.New(pool)
	rolesHandler := roles.New(pool)
	catalogHandler := catalog.New(pool)

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.CORS(cfg.CORSOrigin))
	r.Use(middleware.CSRFMiddleware(auth.CSRFExemptPaths()))

	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })

	auth.RegisterPublicRoutes(r, authHandler)

	authed := r.Group("/")
	authed.Use(middleware.Auth(cfg.JWTSecret))
	auth.RegisterProtectedRoutes(authed, authHandler)
	users.RegisterRoutes(authed, usersHandler)
	roles.RegisterRoutes(authed, rolesHandler)
	catalog.RegisterRoutes(authed, catalogHandler)

	srv := &http.Server{Addr: cfg.ServerAddr, Handler: r}
	go func() {
		log.Printf("api listening on %s", cfg.ServerAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server failed: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctxShutdown, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	if err := srv.Shutdown(ctxShutdown); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}
