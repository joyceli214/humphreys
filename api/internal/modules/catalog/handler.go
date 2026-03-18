package catalog

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

type createLookupRequest struct {
	Label string `json:"label" binding:"required"`
}

type createLocationRequest struct {
	Label *string `json:"label"`
	Shelf *string `json:"shelf"`
	Floor *int32  `json:"floor"`
}

type setDropdownFrozenRequest struct {
	IsFrozen *bool `json:"is_frozen"`
}

type setDropdownOptionActiveRequest struct {
	IsActive *bool `json:"is_active"`
}

func New(db *pgxpool.Pool) *Handler {
	return &Handler{
		service: NewService(NewRepository(db)),
	}
}

func NewWithService(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) ListResources(c *gin.Context) {
	resources, err := h.service.ListResources(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list resources"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": resources})
}

func (h *Handler) ListPermissions(c *gin.Context) {
	permissions, err := h.service.ListPermissions(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list permissions"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": permissions})
}

func (h *Handler) ListDropdownManagement(c *gin.Context) {
	items, err := h.service.ListDropdownManagement(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list dropdown management data"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) SetDropdownFrozen(c *gin.Context) {
	var req setDropdownFrozenRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.IsFrozen == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	if err := h.service.SetDropdownFrozen(c.Request.Context(), c.Param("key"), *req.IsFrozen); errors.Is(err, ErrUnknownDropdownKey) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	} else if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update dropdown freeze state"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) SetDropdownOptionActive(c *gin.Context) {
	optionID, err := strconv.ParseInt(c.Param("optionId"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid dropdown option id"})
		return
	}

	var req setDropdownOptionActiveRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.IsActive == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	err = h.service.SetDropdownOptionActive(c.Request.Context(), c.Param("key"), optionID, *req.IsActive)
	if errors.Is(err, ErrUnknownDropdownKey) || errors.Is(err, ErrInvalidDropdownOptionID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, ErrDropdownOptionNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update dropdown option status"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) ListWorkOrderStatuses(c *gin.Context) {
	items, err := h.service.ListWorkOrderStatuses(c.Request.Context(), c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list work order statuses"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) ListJobTypes(c *gin.Context) {
	items, err := h.service.ListJobTypes(c.Request.Context(), c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list job types"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) ListItems(c *gin.Context) {
	items, err := h.service.ListItems(c.Request.Context(), c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list items"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) ListBrands(c *gin.Context) {
	items, err := h.service.ListBrands(c.Request.Context(), c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list brands"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) ListWorkers(c *gin.Context) {
	items, err := h.service.ListWorkers(c.Request.Context(), c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list workers"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) ListPaymentMethods(c *gin.Context) {
	items, err := h.service.ListPaymentMethods(c.Request.Context(), c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list payment methods"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) ListLocations(c *gin.Context) {
	items, err := h.service.ListLocations(c.Request.Context(), c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list locations"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) ListPartsItemPresets(c *gin.Context) {
	items, err := h.service.ListPartsItemPresets(c.Request.Context(), c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list parts item presets"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateWorkOrderStatus(c *gin.Context) {
	var req createLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	item, err := h.service.CreateWorkOrderStatus(c.Request.Context(), req.Label)
	if errors.Is(err, ErrInvalidLookupLabel) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, ErrDropdownFrozen) {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) CreateJobType(c *gin.Context) {
	var req createLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	item, err := h.service.CreateJobType(c.Request.Context(), req.Label)
	if errors.Is(err, ErrInvalidLookupLabel) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, ErrDropdownFrozen) {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) CreateItem(c *gin.Context) {
	var req createLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	item, err := h.service.CreateItem(c.Request.Context(), req.Label)
	if errors.Is(err, ErrInvalidLookupLabel) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, ErrDropdownFrozen) {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) CreateBrand(c *gin.Context) {
	var req createLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	item, err := h.service.CreateBrand(c.Request.Context(), req.Label)
	if errors.Is(err, ErrInvalidLookupLabel) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, ErrDropdownFrozen) {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) CreateWorker(c *gin.Context) {
	var req createLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	item, err := h.service.CreateWorker(c.Request.Context(), req.Label)
	if errors.Is(err, ErrInvalidLookupLabel) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, ErrDropdownFrozen) {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) CreatePaymentMethod(c *gin.Context) {
	var req createLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	item, err := h.service.CreatePaymentMethod(c.Request.Context(), req.Label)
	if errors.Is(err, ErrInvalidLookupLabel) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, ErrDropdownFrozen) {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) CreateLocation(c *gin.Context) {
	var req createLocationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	shelf := ""
	if req.Shelf != nil {
		shelf = *req.Shelf
	} else if req.Label != nil {
		// Backward-compatible payload for older UI add-new flow.
		shelf = *req.Label
	}
	floor := int32(0)
	if req.Floor != nil {
		floor = *req.Floor
	}

	item, err := h.service.CreateLocation(c.Request.Context(), shelf, floor)
	if errors.Is(err, ErrInvalidLocationShelf) || errors.Is(err, ErrInvalidLocationFloor) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, ErrDropdownFrozen) {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) CreatePartsItemPreset(c *gin.Context) {
	var req createLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	item, err := h.service.CreatePartsItemPreset(c.Request.Context(), req.Label)
	if errors.Is(err, ErrInvalidLookupLabel) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, ErrDropdownFrozen) {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, item)
}
