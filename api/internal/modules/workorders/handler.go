package workorders

import (
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jellydator/ttlcache/v3"
)

type Handler struct {
	service          *Service
	openRouterAPIKey string
	openRouterModel  string
	httpClient       *http.Client
	aiSummaryCache   *ttlcache.Cache[string, aiSummaryCacheItem]
}

type updateEquipmentRequest struct {
	StatusID           *int64  `json:"status_id"`
	JobTypeID          *int64  `json:"job_type_id"`
	ItemID             *int64  `json:"item_id"`
	BrandIDs           []int64 `json:"brand_ids"`
	ModelNumber        *string `json:"model_number"`
	SerialNumber       *string `json:"serial_number"`
	RemoteControlQty   int32   `json:"remote_control_qty" binding:"gte=0"`
	CableQty           int32   `json:"cable_qty" binding:"gte=0"`
	CordQty            int32   `json:"cord_qty" binding:"gte=0"`
	DVDVHSQty          int32   `json:"dvd_vhs_qty" binding:"gte=0"`
	AlbumCDCassetteQty int32   `json:"album_cd_cassette_qty" binding:"gte=0"`
}

type updateStatusRequest struct {
	StatusID *int64 `json:"status_id"`
}

type updateWorkNotesRequest struct {
	ProblemDescription *string `json:"problem_description"`
	WorkerIDs          []int32 `json:"worker_ids"`
	WorkDone           *string `json:"work_done"`
	PaymentMethodIDs   []int32 `json:"payment_method_ids"`
}

type updateLineItemsRequest struct {
	LineItems []lineItemInput `json:"line_items"`
}

type lineItemInput struct {
	LineItemID    *int64   `json:"line_item_id"`
	ItemName      *string  `json:"item_name"`
	UnitPrice     *float64 `json:"unit_price"`
	QuantityText  *string  `json:"quantity_text"`
	LineTotalText *string  `json:"line_total_text"`
}

type updateTotalsRequest struct {
	DeliveryTotal *float64 `json:"delivery_total"`
	LabourTotal   *float64 `json:"labour_total"`
	Deposit       float64  `json:"deposit"`
}

type updateCustomerRequest struct {
	FirstName    *string `json:"first_name"`
	LastName     *string `json:"last_name"`
	Email        *string `json:"email"`
	AddressLine1 *string `json:"address_line_1"`
	AddressLine2 *string `json:"address_line_2"`
	City         *string `json:"city"`
	Province     *string `json:"province"`
	HomePhone    *string `json:"home_phone"`
	WorkPhone    *string `json:"work_phone"`
	Extension    *string `json:"extension_text"`
}

type createWorkOrderCustomerRequest struct {
	Name         string  `json:"name" binding:"required"`
	Email        *string `json:"email"`
	HomePhone    *string `json:"home_phone"`
	WorkPhone    *string `json:"work_phone"`
	Extension    *string `json:"extension_text"`
	AddressLine1 *string `json:"address_line_1"`
	AddressLine2 *string `json:"address_line_2"`
	City         *string `json:"city"`
	Province     *string `json:"province"`
}

type updateWorkOrderCustomerRequest struct {
	Name         string  `json:"name"`
	Email        *string `json:"email"`
	HomePhone    *string `json:"home_phone"`
	WorkPhone    *string `json:"work_phone"`
	Extension    *string `json:"extension_text"`
	AddressLine1 *string `json:"address_line_1"`
	AddressLine2 *string `json:"address_line_2"`
	City         *string `json:"city"`
	Province     *string `json:"province"`
}

type createWorkOrderRequest struct {
	CreationMode           string                          `json:"creation_mode"`
	CustomerID             *int64                          `json:"customer_id"`
	NewCustomer            *createWorkOrderCustomerRequest `json:"new_customer"`
	CustomerUpdates        *updateWorkOrderCustomerRequest `json:"customer_updates"`
	ItemID                 *int64                          `json:"item_id"`
	BrandIDs               []int64                         `json:"brand_ids"`
	ModelNumber            *string                         `json:"model_number"`
	SerialNumber           *string                         `json:"serial_number"`
	RemoteControlQty       int32                           `json:"remote_control_qty" binding:"gte=0"`
	CableQty               int32                           `json:"cable_qty" binding:"gte=0"`
	CordQty                int32                           `json:"cord_qty" binding:"gte=0"`
	DVDVHSQty              int32                           `json:"dvd_vhs_qty" binding:"gte=0"`
	AlbumCDCassetteQty     int32                           `json:"album_cd_cassette_qty" binding:"gte=0"`
	Deposit                float64                         `json:"deposit" binding:"gte=0"`
	DepositPaymentMethodID *int64                          `json:"deposit_payment_method_id"`
}

type createRepairLogRequest struct {
	RepairDate *string  `json:"repair_date"`
	HoursUsed  *float64 `json:"hours_used"`
	Details    string   `json:"details" binding:"required"`
}

type createPartsPurchaseRequest struct {
	Source     string  `json:"source" binding:"required"`
	SourceURL  *string `json:"source_url"`
	Status     *string `json:"status"`
	TotalPrice float64 `json:"total_price"`
	ItemName   string  `json:"item_name" binding:"required"`
	Quantity   int32   `json:"quantity" binding:"required,gte=1"`
}

type updateRepairLogRequest struct {
	RepairDate *string  `json:"repair_date"`
	HoursUsed  *float64 `json:"hours_used"`
	Details    *string  `json:"details"`
}

type updatePartsPurchaseRequest struct {
	Source     string  `json:"source" binding:"required"`
	SourceURL  *string `json:"source_url"`
	Status     string  `json:"status" binding:"required"`
	TotalPrice float64 `json:"total_price"`
	ItemName   string  `json:"item_name" binding:"required"`
	Quantity   int32   `json:"quantity" binding:"required,gte=1"`
}

func New(db *pgxpool.Pool) *Handler {
	aiCache := ttlcache.New[string, aiSummaryCacheItem](ttlcache.WithTTL[string, aiSummaryCacheItem](30 * time.Second))
	go aiCache.Start()

	return &Handler{
		service:          NewService(NewRepository(db)),
		openRouterAPIKey: os.Getenv("OPENROUTER_API_KEY"),
		openRouterModel:  getOpenRouterModel(),
		httpClient:       &http.Client{Timeout: 25 * time.Second},
		aiSummaryCache:   aiCache,
	}
}

func NewWithService(service *Service) *Handler {
	aiCache := ttlcache.New[string, aiSummaryCacheItem](ttlcache.WithTTL[string, aiSummaryCacheItem](30 * time.Second))
	go aiCache.Start()

	return &Handler{
		service:          service,
		openRouterAPIKey: os.Getenv("OPENROUTER_API_KEY"),
		openRouterModel:  getOpenRouterModel(),
		httpClient:       &http.Client{Timeout: 25 * time.Second},
		aiSummaryCache:   aiCache,
	}
}

func (h *Handler) ListWorkOrders(c *gin.Context) {
	query := c.Query("q")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	customerID, err := parsePositiveInt64Query(c.Query("customer_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid customer_id"})
		return
	}
	statusID, err := parsePositiveInt64Query(c.Query("status_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status_id"})
		return
	}
	jobTypeID, err := parsePositiveInt64Query(c.Query("job_type_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid job_type_id"})
		return
	}
	itemID, err := parsePositiveInt64Query(c.Query("item_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item_id"})
		return
	}
	createdFrom, err := parseDateQuery(c.Query("created_from"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid created_from (expected YYYY-MM-DD)"})
		return
	}
	createdTo, err := parseDateQuery(c.Query("created_to"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid created_to (expected YYYY-MM-DD)"})
		return
	}
	filters := WorkOrderListFilters{
		CustomerID:  customerID,
		StatusID:    statusID,
		JobTypeID:   jobTypeID,
		ItemID:      itemID,
		CreatedFrom: createdFrom,
		CreatedTo:   createdTo,
	}
	includeSensitive := hasPermission(c, permSensitiveRead)

	items, err := h.service.ListWorkOrders(c.Request.Context(), query, filters, includeSensitive, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "failed to list work orders",
			"detail": err.Error(),
		})
		return
	}
	if !includeSensitive {
		for i := range items {
			items[i].CustomerEmail = nil
			items[i].LabourTotal = nil
		}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func parsePositiveInt64Query(raw string) (*int64, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	parsed, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil || parsed <= 0 {
		return nil, errors.New("invalid positive integer")
	}
	return &parsed, nil
}

func parseDateQuery(raw string) (*string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	if _, err := time.Parse("2006-01-02", trimmed); err != nil {
		return nil, err
	}
	return &trimmed, nil
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
	if !hasPermission(c, permSensitiveRead) {
		item = sanitizeWorkOrderDetail(item)
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) ListCustomers(c *gin.Context) {
	items, err := h.service.ListCustomers(c.Request.Context(), c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list customers"})
		return
	}
	if !hasPermission(c, permSensitiveRead) {
		for i := range items {
			first := strings.TrimSpace(stringValue(items[i].FirstName))
			last := strings.TrimSpace(stringValue(items[i].LastName))
			name := strings.TrimSpace(strings.Join([]string{first, last}, " "))
			if name == "" {
				name = "Unknown"
			}
			items[i].Label = name
			items[i].Email = nil
			items[i].HomePhone = nil
			items[i].WorkPhone = nil
			items[i].Extension = nil
			items[i].AddressLine1 = nil
			items[i].AddressLine2 = nil
			items[i].City = nil
			items[i].Province = nil
		}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateWorkOrder(c *gin.Context) {
	var req createWorkOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	var newCustomer *CreateWorkOrderCustomerInput
	var customerUpdates *CreateWorkOrderCustomerInput
	if req.NewCustomer != nil {
		newCustomer = &CreateWorkOrderCustomerInput{
			Name:         req.NewCustomer.Name,
			Email:        req.NewCustomer.Email,
			HomePhone:    req.NewCustomer.HomePhone,
			WorkPhone:    req.NewCustomer.WorkPhone,
			Extension:    req.NewCustomer.Extension,
			AddressLine1: req.NewCustomer.AddressLine1,
			AddressLine2: req.NewCustomer.AddressLine2,
			City:         req.NewCustomer.City,
			Province:     req.NewCustomer.Province,
		}
	}
	if req.CustomerUpdates != nil {
		customerUpdates = &CreateWorkOrderCustomerInput{
			Name:         req.CustomerUpdates.Name,
			Email:        req.CustomerUpdates.Email,
			HomePhone:    req.CustomerUpdates.HomePhone,
			WorkPhone:    req.CustomerUpdates.WorkPhone,
			Extension:    req.CustomerUpdates.Extension,
			AddressLine1: req.CustomerUpdates.AddressLine1,
			AddressLine2: req.CustomerUpdates.AddressLine2,
			City:         req.CustomerUpdates.City,
			Province:     req.CustomerUpdates.Province,
		}
	}

	item, err := h.service.CreateWorkOrder(c.Request.Context(), CreateWorkOrderInput{
		CreationMode:           req.CreationMode,
		CustomerID:             req.CustomerID,
		NewCustomer:            newCustomer,
		CustomerUpdates:        customerUpdates,
		ItemID:                 req.ItemID,
		BrandIDs:               req.BrandIDs,
		ModelNumber:            req.ModelNumber,
		SerialNumber:           req.SerialNumber,
		RemoteControlQty:       req.RemoteControlQty,
		CableQty:               req.CableQty,
		CordQty:                req.CordQty,
		DVDVHSQty:              req.DVDVHSQty,
		AlbumCDCassetteQty:     req.AlbumCDCassetteQty,
		Deposit:                req.Deposit,
		DepositPaymentMethodID: req.DepositPaymentMethodID,
	})
	if err != nil {
		if errors.Is(err, ErrInvalidCustomerSelection) ||
			errors.Is(err, ErrCustomerSelectionRequired) ||
			errors.Is(err, ErrCustomerNameRequired) ||
			errors.Is(err, ErrCustomerPhoneRequired) ||
			errors.Is(err, ErrInvalidEmailFormat) ||
			errors.Is(err, ErrInvalidCreationMode) ||
			errors.Is(err, ErrStockJobTypeNotFound) ||
			errors.Is(err, ErrInvalidDeposit) ||
			errors.Is(err, ErrDepositPaymentMethodRequired) ||
			errors.Is(err, ErrPhoneDigitsOnly) ||
			errors.Is(err, ErrCustomerNotFound) ||
			errors.Is(err, ErrPaymentMethodNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create work order", "detail": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) DeleteWorkOrder(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	if err := h.service.DeleteWorkOrder(c.Request.Context(), referenceID); err != nil {
		if errors.Is(err, ErrWorkOrderNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "work order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete work order"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) UpdateEquipment(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	var req updateEquipmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	item, err := h.service.UpdateEquipment(c.Request.Context(), referenceID, EquipmentUpdateInput{
		StatusID:           req.StatusID,
		JobTypeID:          req.JobTypeID,
		ItemID:             req.ItemID,
		BrandIDs:           req.BrandIDs,
		ModelNumber:        req.ModelNumber,
		SerialNumber:       req.SerialNumber,
		RemoteControlQty:   req.RemoteControlQty,
		CableQty:           req.CableQty,
		CordQty:            req.CordQty,
		DVDVHSQty:          req.DVDVHSQty,
		AlbumCDCassetteQty: req.AlbumCDCassetteQty,
	})
	if errors.Is(err, ErrWorkOrderNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "work order not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update work order"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) UpdateStatus(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	var req updateStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	item, err := h.service.UpdateStatus(c.Request.Context(), referenceID, StatusUpdateInput{
		StatusID: req.StatusID,
	})
	if errors.Is(err, ErrWorkOrderNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "work order not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update status"})
		return
	}
	if !hasPermission(c, permSensitiveRead) {
		item = sanitizeWorkOrderDetail(item)
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) UpdateWorkNotes(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	var req updateWorkNotesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	item, err := h.service.UpdateWorkNotes(c.Request.Context(), referenceID, WorkNotesUpdateInput{
		ProblemDescription: req.ProblemDescription,
		WorkerIDs:          req.WorkerIDs,
		WorkDone:           req.WorkDone,
		PaymentMethodIDs:   req.PaymentMethodIDs,
	})
	if errors.Is(err, ErrWorkOrderNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "work order not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update work order"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) UpdateTotals(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	var req updateTotalsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	item, err := h.service.UpdateTotals(c.Request.Context(), referenceID, TotalsUpdateInput{
		DeliveryTotal: req.DeliveryTotal,
		LabourTotal:   req.LabourTotal,
		Deposit:       req.Deposit,
	})
	if errors.Is(err, ErrWorkOrderNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "work order not found"})
		return
	}
	if err != nil {
		if errors.Is(err, ErrInvalidEmailFormat) || errors.Is(err, ErrPhoneDigitsOnly) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update work order"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) UpdateLineItems(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	var req updateLineItemsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	items := make([]LineItemUpsertInput, 0, len(req.LineItems))
	for _, line := range req.LineItems {
		items = append(items, LineItemUpsertInput{
			LineItemID:    line.LineItemID,
			ItemName:      line.ItemName,
			UnitPrice:     line.UnitPrice,
			QuantityText:  line.QuantityText,
			LineTotalText: line.LineTotalText,
		})
	}

	item, err := h.service.UpdateLineItems(c.Request.Context(), referenceID, items)
	if errors.Is(err, ErrWorkOrderNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "work order not found"})
		return
	}
	if errors.Is(err, ErrLineItemNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "line item not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update line items"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) UpdateCustomer(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	var req updateCustomerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	item, err := h.service.UpdateCustomer(c.Request.Context(), referenceID, CustomerUpdateInput{
		FirstName:    req.FirstName,
		LastName:     req.LastName,
		Email:        req.Email,
		AddressLine1: req.AddressLine1,
		AddressLine2: req.AddressLine2,
		City:         req.City,
		Province:     req.Province,
		HomePhone:    req.HomePhone,
		WorkPhone:    req.WorkPhone,
		Extension:    req.Extension,
	})
	if errors.Is(err, ErrWorkOrderNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "work order not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update work order"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) ListRepairLogs(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}
	items, err := h.service.ListRepairLogs(c.Request.Context(), referenceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list repair logs"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) ListAllPartsPurchaseRequests(c *gin.Context) {
	items, err := h.service.ListAllPartsPurchaseRequests(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list parts purchase requests"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateRepairLog(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	claims, ok := middleware.Claims(c)
	if !ok || claims.UserID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing auth context"})
		return
	}

	var req createRepairLogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	item, err := h.service.CreateRepairLog(c.Request.Context(), referenceID, CreateRepairLogInput{
		RepairDate:      req.RepairDate,
		HoursUsed:       req.HoursUsed,
		Details:         req.Details,
		CreatedByUserID: claims.UserID,
	})
	if err != nil {
		if errors.Is(err, ErrInvalidRepairLogDetails) || errors.Is(err, ErrInvalidRepairLogHoursUsed) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create repair log"})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) UpdateRepairLog(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}
	repairLogID, err := strconv.ParseInt(c.Param("repair_log_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid repair_log_id"})
		return
	}

	var req updateRepairLogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	item, err := h.service.UpdateRepairLog(c.Request.Context(), referenceID, repairLogID, UpdateRepairLogInput{
		RepairDate: req.RepairDate,
		HoursUsed:  req.HoursUsed,
		Details:    req.Details,
	})
	if err != nil {
		if errors.Is(err, ErrRepairLogNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, ErrInvalidRepairLogDetails) || errors.Is(err, ErrInvalidRepairLogHoursUsed) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update repair log"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) DeleteRepairLog(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}
	repairLogID, err := strconv.ParseInt(c.Param("repair_log_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid repair_log_id"})
		return
	}

	if err := h.service.DeleteRepairLog(c.Request.Context(), referenceID, repairLogID); err != nil {
		if errors.Is(err, ErrRepairLogNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete repair log"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) ListPartsPurchaseRequests(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}
	items, err := h.service.ListPartsPurchaseRequests(c.Request.Context(), referenceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list parts purchase requests"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreatePartsPurchaseRequest(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}

	claims, ok := middleware.Claims(c)
	if !ok || claims.UserID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing auth context"})
		return
	}

	var req createPartsPurchaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	item, err := h.service.CreatePartsPurchaseRequest(c.Request.Context(), referenceID, CreatePartsPurchaseRequestInput{
		Source:          req.Source,
		SourceURL:       req.SourceURL,
		Status:          req.Status,
		TotalPrice:      req.TotalPrice,
		ItemName:        req.ItemName,
		Quantity:        req.Quantity,
		CreatedByUserID: claims.UserID,
	})
	if err != nil {
		if errors.Is(err, ErrInvalidPartsSource) ||
			errors.Is(err, ErrInvalidPartsStatus) ||
			errors.Is(err, ErrInvalidPartsItemName) ||
			errors.Is(err, ErrInvalidPartsQuantity) ||
			errors.Is(err, ErrInvalidPartsTotalPrice) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create parts purchase request"})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) UpdatePartsPurchaseRequest(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}
	partsPurchaseRequestID, err := strconv.ParseInt(c.Param("parts_purchase_request_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid parts_purchase_request_id"})
		return
	}

	var req updatePartsPurchaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	item, err := h.service.UpdatePartsPurchaseRequest(c.Request.Context(), referenceID, partsPurchaseRequestID, UpdatePartsPurchaseRequestInput{
		Source:     req.Source,
		SourceURL:  req.SourceURL,
		Status:     req.Status,
		TotalPrice: req.TotalPrice,
		ItemName:   req.ItemName,
		Quantity:   req.Quantity,
	})
	if err != nil {
		if errors.Is(err, ErrPartsPurchaseRequestNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, ErrInvalidPartsSource) ||
			errors.Is(err, ErrInvalidPartsStatus) ||
			errors.Is(err, ErrInvalidPartsItemName) ||
			errors.Is(err, ErrInvalidPartsQuantity) ||
			errors.Is(err, ErrInvalidPartsTotalPrice) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update parts purchase request"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) DeletePartsPurchaseRequest(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}
	partsPurchaseRequestID, err := strconv.ParseInt(c.Param("parts_purchase_request_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid parts_purchase_request_id"})
		return
	}

	if err := h.service.DeletePartsPurchaseRequest(c.Request.Context(), referenceID, partsPurchaseRequestID); err != nil {
		if errors.Is(err, ErrPartsPurchaseRequestNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete parts purchase request"})
		return
	}
	c.Status(http.StatusNoContent)
}

func hasPermission(c *gin.Context, permission string) bool {
	claims, ok := middleware.Claims(c)
	if !ok {
		return false
	}
	for _, code := range claims.Scope {
		if code == permission {
			return true
		}
	}
	return false
}

func sanitizeWorkOrderDetail(detail domain.WorkOrderDetail) domain.WorkOrderDetail {
	detail.Customer = domain.WorkOrderCustomer{
		CustomerID: detail.Customer.CustomerID,
		FirstName:  detail.Customer.FirstName,
		LastName:   detail.Customer.LastName,
	}
	detail.PartsTotal = nil
	detail.DeliveryTotal = nil
	detail.LabourTotal = nil
	detail.Deposit = 0
	detail.LineItems = []domain.WorkOrderLineItem{}
	detail.PaymentMethodIDs = []int64{}
	detail.PaymentMethodNames = []string{}
	return detail
}
