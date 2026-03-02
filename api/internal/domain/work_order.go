package domain

import "time"

type WorkOrderListItem struct {
	ReferenceID   int32      `json:"reference_id"`
	CreatedAt     *time.Time `json:"created_at"`
	UpdatedAt     *time.Time `json:"updated_at"`
	Status        string     `json:"status"`
	JobType       string     `json:"job_type"`
	CustomerName  *string    `json:"customer_name"`
	CustomerEmail *string    `json:"customer_email"`
	ItemName      *string    `json:"item_name"`
	BrandNames    []string   `json:"brand_names"`
	ModelNumber   *string    `json:"model_number"`
	SerialNumber  *string    `json:"serial_number"`
	LabourTotal   *float64   `json:"labour_total"`
}

type WorkOrderCustomer struct {
	CustomerID   *int64  `json:"customer_id"`
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

type WorkOrderLineItem struct {
	LineItemID    int64    `json:"line_item_id"`
	ItemName      *string  `json:"item_name"`
	UnitPrice     *float64 `json:"unit_price"`
	QuantityText  *string  `json:"quantity_text"`
	LineTotalText *string  `json:"line_total_text"`
}

type WorkOrderDetail struct {
	ReferenceID        int32               `json:"reference_id"`
	OriginalJobID      *int32              `json:"original_job_id"`
	CreatedAt          *time.Time          `json:"created_at"`
	UpdatedAt          *time.Time          `json:"updated_at"`
	StatusID           *int64              `json:"status_id"`
	StatusKey          *string             `json:"status_key"`
	StatusName         *string             `json:"status_name"`
	StatusUpdatedAt    *time.Time          `json:"status_updated_at"`
	JobTypeID          *int64              `json:"job_type_id"`
	JobTypeKey         *string             `json:"job_type_key"`
	JobTypeName        *string             `json:"job_type_name"`
	Customer           WorkOrderCustomer   `json:"customer"`
	ItemID             *int64              `json:"item_id"`
	ItemName           *string             `json:"item_name"`
	BrandIDs           []int64             `json:"brand_ids"`
	BrandNames         []string            `json:"brand_names"`
	ModelNumber        *string             `json:"model_number"`
	SerialNumber       *string             `json:"serial_number"`
	RemoteControlQty   int32               `json:"remote_control_qty"`
	CableQty           int32               `json:"cable_qty"`
	CordQty            int32               `json:"cord_qty"`
	DVDVHSQty          int32               `json:"dvd_vhs_qty"`
	AlbumCDCassetteQty int32               `json:"album_cd_cassette_qty"`
	ProblemDescription *string             `json:"problem_description"`
	WorkerIDs          []int64             `json:"worker_ids"`
	WorkerNames        []string            `json:"worker_names"`
	WorkDone           *string             `json:"work_done"`
	PaymentMethodIDs   []int64             `json:"payment_method_ids"`
	PaymentMethodNames []string            `json:"payment_method_names"`
	PartsTotal         *float64            `json:"parts_total"`
	DeliveryTotal      *float64            `json:"delivery_total"`
	LabourTotal        *float64            `json:"labour_total"`
	Deposit            float64             `json:"deposit"`
	LineItems          []WorkOrderLineItem `json:"line_items"`
}

type RepairLog struct {
	RepairLogID      int64      `json:"repair_log_id"`
	ReferenceID      int32      `json:"reference_id"`
	RepairDate       *time.Time `json:"repair_date"`
	HoursUsed        float64    `json:"hours_used"`
	Details          string     `json:"details"`
	CreatedByUserID  string     `json:"created_by_user_id"`
	CreatedByName    *string    `json:"created_by_name"`
	CreatedAt        *time.Time `json:"created_at"`
	UpdatedAt        *time.Time `json:"updated_at"`
}

type PartsPurchaseRequest struct {
	PartsPurchaseRequestID int64      `json:"parts_purchase_request_id"`
	ReferenceID            int32      `json:"reference_id"`
	Source                 string     `json:"source"`
	SourceURL              *string    `json:"source_url"`
	Status                 string     `json:"status"`
	TotalPrice             float64    `json:"total_price"`
	ItemName               string     `json:"item_name"`
	Quantity               int32      `json:"quantity"`
	CreatedByUserID        string     `json:"created_by_user_id"`
	CreatedByName          *string    `json:"created_by_name"`
	CreatedAt              *time.Time `json:"created_at"`
	UpdatedAt              *time.Time `json:"updated_at"`
}
