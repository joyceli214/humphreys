package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"humphreys/api/internal/config"
	"humphreys/api/internal/db"
	"humphreys/api/internal/handlers"
	"humphreys/api/internal/middleware"
	"humphreys/api/internal/security"
	"humphreys/api/internal/store"

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

	ownerHash, err := security.HashPassword(cfg.OwnerPassword)
	if err != nil {
		log.Fatalf("owner password hash failed: %v", err)
	}
	st := store.New(pool)
	if err := st.EnsureOwner(ctx, cfg.OwnerEmail, ownerHash, cfg.OwnerFullName); err != nil {
		log.Fatalf("owner bootstrap failed: %v", err)
	}

	h := handlers.New(st, cfg)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.CORS(cfg.CORSOrigin))

	exempt := map[string]struct{}{
		"/auth/login": {},
	}
	r.Use(middleware.CSRFMiddleware(exempt))

	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })

	r.POST("/auth/login", h.Login)
	r.POST("/auth/refresh", h.Refresh)

	authed := r.Group("/")
	authed.Use(middleware.Auth(cfg.JWTSecret))
	{
		authed.POST("/auth/logout", h.Logout)
		authed.GET("/auth/me", h.Me)

		authed.GET("/users", middleware.RequirePermission("users:read"), h.ListUsers)
		authed.POST("/users", middleware.RequirePermission("users:create"), h.CreateUser)
		authed.GET("/users/:id", middleware.RequirePermission("users:read"), h.GetUser)
		authed.PATCH("/users/:id", middleware.RequirePermission("users:update"), h.UpdateUser)
		authed.PATCH("/users/:id/status", middleware.RequirePermission("users:update"), h.UpdateUserStatus)
		authed.PATCH("/users/:id/roles", middleware.RequirePermission("users:assign"), h.SetUserRoles)

		authed.GET("/roles", middleware.RequirePermission("roles:read"), h.ListRoles)
		authed.POST("/roles", middleware.RequirePermission("roles:create"), h.CreateRole)
		authed.GET("/roles/:id", middleware.RequirePermission("roles:read"), h.GetRole)
		authed.PATCH("/roles/:id", middleware.RequirePermission("roles:update"), h.UpdateRole)
		authed.DELETE("/roles/:id", middleware.RequirePermission("roles:delete"), h.DeleteRole)
		authed.PATCH("/roles/:id/permissions", middleware.RequirePermission("roles:assign"), h.SetRolePermissions)

		authed.GET("/resources", middleware.RequirePermission("resources:read"), h.ListResources)
		authed.GET("/permissions", middleware.RequirePermission("permissions:read"), h.ListPermissions)
	}

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
