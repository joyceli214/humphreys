package workorders

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	service *Service
}

func New(db *pgxpool.Pool) *Handler {
	return &Handler{service: NewService(NewRepository(db))}
}

func NewWithService(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) ListWorkOrders(c *gin.Context) {
	query := c.Query("q")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	items, err := h.service.ListWorkOrders(c.Request.Context(), query, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "failed to list work orders",
			"detail": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) GetWorkOrder(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	item, err := h.service.GetWorkOrderDetail(c.Request.Context(), referenceID)
	if errors.Is(err, ErrWorkOrderNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "work order not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch work order"})
		return
	}
	c.JSON(http.StatusOK, item)
}
