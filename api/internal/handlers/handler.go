package handlers

import (
	"time"

	"humphreys/api/internal/config"
	"humphreys/api/internal/store"
)

type Handler struct {
	Store *store.Store
	Cfg   config.Config
	Now   func() time.Time
}

func New(st *store.Store, cfg config.Config) *Handler {
	return &Handler{Store: st, Cfg: cfg, Now: time.Now}
}
