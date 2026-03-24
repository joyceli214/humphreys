package workorders

import (
	"context"
	"errors"
	"net/mail"
	"regexp"
	"strings"

	"humphreys/api/internal/domain"

	"github.com/jackc/pgx/v5"
)

var ErrWorkOrderNotFound = errors.New("work order not found")
var ErrLineItemNotFound = errors.New("line item not found")
var ErrInvalidEmailFormat = errors.New("invalid email format")
var ErrPhoneDigitsOnly = errors.New("phone must contain numbers only")
var ErrInvalidCustomerSelection = errors.New("choose either an existing customer or create a new one")
var ErrCustomerSelectionRequired = errors.New("customer is required")
var ErrCustomerNameRequired = errors.New("customer name is required")
var ErrCustomerPhoneRequired = errors.New("home phone or work phone is required")
var ErrInvalidDeposit = errors.New("deposit must be zero or greater")
var ErrDepositPaymentMethodRequired = errors.New("deposit payment method is required")
var ErrCustomerNotFound = errors.New("customer not found")
var ErrPaymentMethodNotFound = errors.New("payment method not found")
var ErrLocationNotFound = errors.New("location not found")
var ErrInvalidRepairLogDetails = errors.New("repair log details are required")
var ErrInvalidRepairLogHoursUsed = errors.New("repair log hours_used must be zero or greater")
var ErrInvalidPartsSource = errors.New("parts source must be online or supplier")
var ErrInvalidPartsStatus = errors.New("parts status must be draft, waiting_approval, ordered, or used")
var ErrInvalidPartsItemName = errors.New("parts item name is required")
var ErrInvalidPartsQuantity = errors.New("parts quantity must be at least 1")
var ErrInvalidPartsTotalPrice = errors.New("parts total price must be zero or greater")
var ErrRepairLogNotFound = errors.New("repair log not found")
var ErrPartsPurchaseRequestNotFound = errors.New("parts purchase request not found")
var ErrInvalidCreationMode = errors.New("creation mode must be new_job or stock")
var ErrStockJobTypeNotFound = errors.New("stock job type not found")
var ErrJobTypeNotFound = errors.New("job type not found")
var ErrOriginalJobNotFound = errors.New("original job not found")
var ErrInvalidOriginalJobID = errors.New("original_job_id must be a positive integer")

type Service struct {
	repo Repository
}

type WorkOrderListFilters struct {
	CustomerID  *int64
	StatusID    *int64
	JobTypeID   *int64
	ItemID      *int64
	CreatedFrom *string
	CreatedTo   *string
}

type DashboardQueryInput struct {
	RangeStart      string
	ReadyPage       int
	ReadyPageSize   int
	OverduePage     int
	OverduePageSize int
	IncludeParts    bool
	IncludeActivity bool
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) ListWorkOrders(ctx context.Context, query string, filters WorkOrderListFilters, includeSensitive bool, page, pageSize int) ([]domain.WorkOrderListItem, error) {
	return s.repo.ListWorkOrders(ctx, query, filters, includeSensitive, page, pageSize)
}

func (s *Service) GetDashboardData(ctx context.Context, input DashboardQueryInput) (domain.DashboardData, error) {
	return s.repo.GetDashboardData(ctx, input)
}

func (s *Service) GetWorkOrderDetail(ctx context.Context, referenceID int) (domain.WorkOrderDetail, error) {
	detail, err := s.repo.GetWorkOrderDetail(ctx, referenceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.WorkOrderDetail{}, ErrWorkOrderNotFound
	}
	return detail, err
}

type EquipmentUpdateInput struct {
	StatusID           *int64
	JobTypeID          *int64
	LocationID         *int64
	ItemID             *int64
	BrandIDs           []int64
	ModelNumber        *string
	SerialNumber       *string
	OtherRemarks       *string
	RemoteControlQty   int32
	CableQty           int32
	CordQty            int32
	DVDVHSQty          int32
	AlbumCDCassetteQty int32
}

type StatusUpdateInput struct {
	StatusID *int64
}

type WorkNotesUpdateInput struct {
	ProblemDescription *string
	WorkerIDs          []int32
	WorkDone           *string
	PaymentMethodIDs   []int32
}

type LineItemUpsertInput struct {
	LineItemID    *int64
	ItemName      *string
	UnitPrice     *float64
	QuantityText  *string
	LineTotalText *string
}

type TotalsUpdateInput struct {
	DeliveryTotal *float64
	LabourTotal   *float64
	Deposit       float64
}

type CustomerUpdateInput struct {
	FirstName    *string
	LastName     *string
	Email        *string
	AddressLine1 *string
	AddressLine2 *string
	City         *string
	Province     *string
	HomePhone    *string
	WorkPhone    *string
	Extension    *string
}

type CreateRepairLogInput struct {
	RepairDate      *string
	HoursUsed       *float64
	Details         string
	CreatedByUserID string
}

type CreatePartsPurchaseRequestInput struct {
	Source          string
	SourceURL       *string
	Status          *string
	TotalPrice      float64
	ItemName        string
	Quantity        int32
	CreatedByUserID string
}

type UpdateRepairLogInput struct {
	RepairDate *string
	HoursUsed  *float64
	Details    *string
}

type UpdatePartsPurchaseRequestInput struct {
	Source     string
	SourceURL  *string
	Status     string
	TotalPrice float64
	ItemName   string
	Quantity   int32
}

type CustomerLookupOption struct {
	ID           int64   `json:"id"`
	Label        string  `json:"label"`
	FirstName    *string `json:"first_name"`
	LastName     *string `json:"last_name"`
	Email        *string `json:"email"`
	HomePhone    *string `json:"home_phone"`
	WorkPhone    *string `json:"work_phone"`
	Extension    *string `json:"extension_text"`
	AddressLine1 *string `json:"address_line_1"`
	AddressLine2 *string `json:"address_line_2"`
	City         *string `json:"city"`
	Province     *string `json:"province"`
}

type CreateWorkOrderCustomerInput struct {
	Name         string
	Email        *string
	HomePhone    *string
	WorkPhone    *string
	Extension    *string
	AddressLine1 *string
	AddressLine2 *string
	City         *string
	Province     *string
}

type CreateWorkOrderInput struct {
	CreationMode           string
	OriginalJobID          *int64
	CustomerID             *int64
	NewCustomer            *CreateWorkOrderCustomerInput
	CustomerUpdates        *CreateWorkOrderCustomerInput
	JobTypeID              *int64
	LocationID             *int64
	ItemID                 *int64
	BrandIDs               []int64
	ModelNumber            *string
	SerialNumber           *string
	RemoteControlQty       int32
	CableQty               int32
	CordQty                int32
	DVDVHSQty              int32
	AlbumCDCassetteQty     int32
	Deposit                float64
	DepositPaymentMethodID *int64
}

func (s *Service) UpdateEquipment(ctx context.Context, referenceID int, input EquipmentUpdateInput) (domain.WorkOrderDetail, error) {
	if err := s.repo.UpdateEquipment(ctx, referenceID, input); err != nil {
		return domain.WorkOrderDetail{}, err
	}
	return s.GetWorkOrderDetail(ctx, referenceID)
}

func (s *Service) ListCustomers(ctx context.Context, query string) ([]CustomerLookupOption, error) {
	return s.repo.ListCustomers(ctx, query)
}

func (s *Service) CreateWorkOrder(ctx context.Context, input CreateWorkOrderInput) (domain.WorkOrderDetail, error) {
	mode := strings.TrimSpace(strings.ToLower(input.CreationMode))
	if mode == "" {
		mode = "new_job"
	}
	if mode != "new_job" && mode != "stock" {
		return domain.WorkOrderDetail{}, ErrInvalidCreationMode
	}
	input.CreationMode = mode

	if input.Deposit < 0 {
		return domain.WorkOrderDetail{}, ErrInvalidDeposit
	}
	if input.OriginalJobID != nil && *input.OriginalJobID <= 0 {
		return domain.WorkOrderDetail{}, ErrInvalidOriginalJobID
	}
	if input.Deposit > 0 && (input.DepositPaymentMethodID == nil || *input.DepositPaymentMethodID <= 0) {
		return domain.WorkOrderDetail{}, ErrDepositPaymentMethodRequired
	}

	if input.CreationMode == "stock" {
		input.CustomerID = nil
		input.NewCustomer = nil
		input.CustomerUpdates = nil
		return s.repo.CreateWorkOrder(ctx, input)
	}

	hasExisting := input.CustomerID != nil && *input.CustomerID > 0
	hasNew := input.NewCustomer != nil
	if hasExisting && hasNew {
		return domain.WorkOrderDetail{}, ErrInvalidCustomerSelection
	}
	if !hasExisting && !hasNew {
		return domain.WorkOrderDetail{}, ErrCustomerSelectionRequired
	}
	if hasExisting {
		if input.CustomerUpdates != nil {
			sanitizeCustomerInput(input.CustomerUpdates, false)
			if input.CustomerUpdates.Email != nil {
				if _, err := mail.ParseAddress(*input.CustomerUpdates.Email); err != nil {
					return domain.WorkOrderDetail{}, ErrInvalidEmailFormat
				}
			}
			onlyDigits := regexp.MustCompile(`^\d+$`)
			for _, phone := range []*string{input.CustomerUpdates.HomePhone, input.CustomerUpdates.WorkPhone} {
				if phone == nil || strings.TrimSpace(*phone) == "" {
					continue
				}
				if !onlyDigits.MatchString(*phone) {
					return domain.WorkOrderDetail{}, ErrPhoneDigitsOnly
				}
			}
		}
	}
	if hasNew {
		sanitizeCustomerInput(input.NewCustomer, true)
		name := strings.TrimSpace(input.NewCustomer.Name)
		homePhone := strings.TrimSpace(stringValue(input.NewCustomer.HomePhone))
		workPhone := strings.TrimSpace(stringValue(input.NewCustomer.WorkPhone))
		if name == "" {
			return domain.WorkOrderDetail{}, ErrCustomerNameRequired
		}
		if homePhone == "" && workPhone == "" {
			return domain.WorkOrderDetail{}, ErrCustomerPhoneRequired
		}
		onlyDigits := regexp.MustCompile(`^\d+$`)
		if homePhone != "" && !onlyDigits.MatchString(homePhone) {
			return domain.WorkOrderDetail{}, ErrPhoneDigitsOnly
		}
		if workPhone != "" && !onlyDigits.MatchString(workPhone) {
			return domain.WorkOrderDetail{}, ErrPhoneDigitsOnly
		}
		input.NewCustomer.Name = name
		if input.NewCustomer.Email != nil {
			if _, err := mail.ParseAddress(*input.NewCustomer.Email); err != nil {
				return domain.WorkOrderDetail{}, ErrInvalidEmailFormat
			}
		}
	}
	if hasExisting && input.CustomerID != nil && *input.CustomerID <= 0 {
		return domain.WorkOrderDetail{}, ErrCustomerSelectionRequired
	}

	return s.repo.CreateWorkOrder(ctx, input)
}

func (s *Service) DeleteWorkOrder(ctx context.Context, referenceID int) error {
	return s.repo.DeleteWorkOrder(ctx, referenceID)
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func trimStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func sanitizeCustomerInput(input *CreateWorkOrderCustomerInput, trimName bool) {
	if input == nil {
		return
	}
	if trimName {
		input.Name = strings.TrimSpace(input.Name)
	}
	input.Email = trimStringPtr(input.Email)
	input.HomePhone = trimStringPtr(input.HomePhone)
	input.WorkPhone = trimStringPtr(input.WorkPhone)
	input.Extension = trimStringPtr(input.Extension)
	input.AddressLine1 = trimStringPtr(input.AddressLine1)
	input.AddressLine2 = trimStringPtr(input.AddressLine2)
	input.City = trimStringPtr(input.City)
	input.Province = trimStringPtr(input.Province)
}

func (s *Service) UpdateStatus(ctx context.Context, referenceID int, input StatusUpdateInput) (domain.WorkOrderDetail, error) {
	if err := s.repo.UpdateStatus(ctx, referenceID, input.StatusID); err != nil {
		return domain.WorkOrderDetail{}, err
	}
	return s.GetWorkOrderDetail(ctx, referenceID)
}

func (s *Service) UpdateWorkNotes(ctx context.Context, referenceID int, input WorkNotesUpdateInput) (domain.WorkOrderDetail, error) {
	// Keep payment methods ordered as [deposit, final], capped at 2 entries.
	normalizedPaymentMethodIDs := make([]int32, 0, 2)
	seenPaymentMethodID := make(map[int32]struct{})
	for _, id := range input.PaymentMethodIDs {
		if id <= 0 {
			continue
		}
		if _, exists := seenPaymentMethodID[id]; exists {
			continue
		}
		seenPaymentMethodID[id] = struct{}{}
		normalizedPaymentMethodIDs = append(normalizedPaymentMethodIDs, id)
		if len(normalizedPaymentMethodIDs) == 2 {
			break
		}
	}
	input.PaymentMethodIDs = normalizedPaymentMethodIDs

	if err := s.repo.UpdateWorkNotes(ctx, referenceID, input); err != nil {
		return domain.WorkOrderDetail{}, err
	}
	return s.GetWorkOrderDetail(ctx, referenceID)
}

func (s *Service) UpdateLineItems(ctx context.Context, referenceID int, lineItems []LineItemUpsertInput) (domain.WorkOrderDetail, error) {
	if err := s.repo.UpdateLineItems(ctx, referenceID, lineItems); err != nil {
		return domain.WorkOrderDetail{}, err
	}
	return s.GetWorkOrderDetail(ctx, referenceID)
}

func (s *Service) UpdateTotals(ctx context.Context, referenceID int, input TotalsUpdateInput) (domain.WorkOrderDetail, error) {
	if err := s.repo.UpdateTotals(ctx, referenceID, input); err != nil {
		return domain.WorkOrderDetail{}, err
	}
	return s.GetWorkOrderDetail(ctx, referenceID)
}

func (s *Service) UpdateCustomer(ctx context.Context, referenceID int, input CustomerUpdateInput) (domain.WorkOrderDetail, error) {
	if input.Email != nil {
		email := strings.TrimSpace(*input.Email)
		if email != "" {
			if _, err := mail.ParseAddress(email); err != nil {
				return domain.WorkOrderDetail{}, ErrInvalidEmailFormat
			}
		}
	}
	onlyDigits := regexp.MustCompile(`^\d+$`)
	for _, phone := range []*string{input.HomePhone, input.WorkPhone} {
		if phone == nil {
			continue
		}
		trimmed := strings.TrimSpace(*phone)
		if trimmed == "" {
			continue
		}
		if !onlyDigits.MatchString(trimmed) {
			return domain.WorkOrderDetail{}, ErrPhoneDigitsOnly
		}
	}

	if err := s.repo.UpdateCustomer(ctx, referenceID, input); err != nil {
		return domain.WorkOrderDetail{}, err
	}
	return s.GetWorkOrderDetail(ctx, referenceID)
}

func (s *Service) ListRepairLogs(ctx context.Context, referenceID int) ([]domain.RepairLog, error) {
	return s.repo.ListRepairLogs(ctx, referenceID)
}

func (s *Service) ListAllPartsPurchaseRequests(ctx context.Context) ([]domain.PartsPurchaseRequest, error) {
	return s.repo.ListAllPartsPurchaseRequests(ctx)
}

func (s *Service) CreateRepairLog(ctx context.Context, referenceID int, input CreateRepairLogInput) (domain.RepairLog, error) {
	details := strings.TrimSpace(input.Details)
	if details == "" {
		return domain.RepairLog{}, ErrInvalidRepairLogDetails
	}
	if input.HoursUsed != nil && *input.HoursUsed < 0 {
		return domain.RepairLog{}, ErrInvalidRepairLogHoursUsed
	}
	return s.repo.CreateRepairLog(ctx, referenceID, input.RepairDate, input.HoursUsed, details, input.CreatedByUserID)
}

func (s *Service) ListPartsPurchaseRequests(ctx context.Context, referenceID int) ([]domain.PartsPurchaseRequest, error) {
	return s.repo.ListPartsPurchaseRequests(ctx, referenceID)
}

func (s *Service) CreatePartsPurchaseRequest(ctx context.Context, referenceID int, input CreatePartsPurchaseRequestInput) (domain.PartsPurchaseRequest, error) {
	source := strings.TrimSpace(strings.ToLower(input.Source))
	if source != "online" && source != "supplier" {
		return domain.PartsPurchaseRequest{}, ErrInvalidPartsSource
	}

	status := "draft"
	if input.Status != nil {
		normalized := strings.TrimSpace(strings.ToLower(*input.Status))
		if normalized != "" {
			status = normalized
		}
	}
	if status != "draft" && status != "waiting_approval" && status != "ordered" && status != "used" {
		return domain.PartsPurchaseRequest{}, ErrInvalidPartsStatus
	}

	itemName := strings.TrimSpace(input.ItemName)
	if itemName == "" {
		return domain.PartsPurchaseRequest{}, ErrInvalidPartsItemName
	}
	if input.Quantity < 1 {
		return domain.PartsPurchaseRequest{}, ErrInvalidPartsQuantity
	}
	if input.TotalPrice < 0 {
		return domain.PartsPurchaseRequest{}, ErrInvalidPartsTotalPrice
	}

	return s.repo.CreatePartsPurchaseRequest(ctx, referenceID, CreatePartsPurchaseRequestInput{
		Source:          source,
		SourceURL:       input.SourceURL,
		Status:          &status,
		TotalPrice:      input.TotalPrice,
		ItemName:        itemName,
		Quantity:        input.Quantity,
		CreatedByUserID: input.CreatedByUserID,
	})
}

func (s *Service) UpdateRepairLog(ctx context.Context, referenceID int, repairLogID int64, input UpdateRepairLogInput) (domain.RepairLog, error) {
	var details *string
	if input.Details != nil {
		trimmed := strings.TrimSpace(*input.Details)
		if trimmed == "" {
			return domain.RepairLog{}, ErrInvalidRepairLogDetails
		}
		details = &trimmed
	}
	if input.HoursUsed != nil && *input.HoursUsed < 0 {
		return domain.RepairLog{}, ErrInvalidRepairLogHoursUsed
	}
	return s.repo.UpdateRepairLog(ctx, referenceID, repairLogID, input.RepairDate, input.HoursUsed, details)
}

func (s *Service) DeleteRepairLog(ctx context.Context, referenceID int, repairLogID int64) error {
	return s.repo.DeleteRepairLog(ctx, referenceID, repairLogID)
}

func (s *Service) UpdatePartsPurchaseRequest(ctx context.Context, referenceID int, partsPurchaseRequestID int64, input UpdatePartsPurchaseRequestInput) (domain.PartsPurchaseRequest, error) {
	source := strings.TrimSpace(strings.ToLower(input.Source))
	if source != "online" && source != "supplier" {
		return domain.PartsPurchaseRequest{}, ErrInvalidPartsSource
	}
	status := strings.TrimSpace(strings.ToLower(input.Status))
	if status != "draft" && status != "waiting_approval" && status != "ordered" && status != "used" {
		return domain.PartsPurchaseRequest{}, ErrInvalidPartsStatus
	}
	itemName := strings.TrimSpace(input.ItemName)
	if itemName == "" {
		return domain.PartsPurchaseRequest{}, ErrInvalidPartsItemName
	}
	if input.Quantity < 1 {
		return domain.PartsPurchaseRequest{}, ErrInvalidPartsQuantity
	}
	if input.TotalPrice < 0 {
		return domain.PartsPurchaseRequest{}, ErrInvalidPartsTotalPrice
	}
	return s.repo.UpdatePartsPurchaseRequest(ctx, referenceID, partsPurchaseRequestID, UpdatePartsPurchaseRequestInput{
		Source:     source,
		SourceURL:  input.SourceURL,
		Status:     status,
		TotalPrice: input.TotalPrice,
		ItemName:   itemName,
		Quantity:   input.Quantity,
	})
}

func (s *Service) DeletePartsPurchaseRequest(ctx context.Context, referenceID int, partsPurchaseRequestID int64) error {
	return s.repo.DeletePartsPurchaseRequest(ctx, referenceID, partsPurchaseRequestID)
}
