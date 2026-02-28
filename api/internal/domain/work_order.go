package domain

import "time"

type WorkOrderListItem struct {
	ReferenceID  int32      `json:"reference_id"`
	CreatedAt    *time.Time `json:"created_at"`
	UpdatedAt    *time.Time `json:"updated_at"`
	Status       string     `json:"status"`
	JobType      string     `json:"job_type"`
	CustomerName *string    `json:"customer_name"`
	CustomerEmail *string   `json:"customer_email"`
	ItemName     *string    `json:"item_name"`
	BrandNames   []string   `json:"brand_names"`
	ModelNumber  *string    `json:"model_number"`
	SerialNumber *string    `json:"serial_number"`
	LabourTotal  *float64   `json:"labour_total"`
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
	LineItemID   int64    `json:"line_item_id"`
	ItemName     *string  `json:"item_name"`
	UnitPrice    *float64 `json:"unit_price"`
	QuantityText *string  `json:"quantity_text"`
	LineTotalText *string `json:"line_total_text"`
}

type WorkOrderDetail struct {
	ReferenceID          int32               `json:"reference_id"`
	OriginalJobID        *int32              `json:"original_job_id"`
	CreatedAt            *time.Time          `json:"created_at"`
	UpdatedAt            *time.Time          `json:"updated_at"`
	StatusKey            *string             `json:"status_key"`
	StatusName           *string             `json:"status_name"`
	JobTypeKey           *string             `json:"job_type_key"`
	JobTypeName          *string             `json:"job_type_name"`
	Customer             WorkOrderCustomer   `json:"customer"`
	ItemID               *int64              `json:"item_id"`
	ItemName             *string             `json:"item_name"`
	BrandNames           []string            `json:"brand_names"`
	ModelNumber          *string             `json:"model_number"`
	SerialNumber         *string             `json:"serial_number"`
	RemoteControlQty     int32               `json:"remote_control_qty"`
	CableQty             int32               `json:"cable_qty"`
	CordQty              int32               `json:"cord_qty"`
	AlbumCDCassetteQty   int32               `json:"album_cd_cassette_qty"`
	ProblemDescription   *string             `json:"problem_description"`
	WorkerNames          []string            `json:"worker_names"`
	WorkDone             *string             `json:"work_done"`
	PaymentMethodNames   []string            `json:"payment_method_names"`
	PartsTotal           *float64            `json:"parts_total"`
	DeliveryTotal        *float64            `json:"delivery_total"`
	LabourTotal          *float64            `json:"labour_total"`
	Deposit              float64             `json:"deposit"`
	LineItems            []WorkOrderLineItem `json:"line_items"`
}
