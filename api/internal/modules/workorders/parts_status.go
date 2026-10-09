package workorders

import "errors"

var ErrInvalidPartsTransition = errors.New("invalid parts status transition")
var ErrPartsApprovalPermission = errors.New("work_orders_sensitive:read permission required")

func validPartsStatus(status string) bool {
	switch status {
	case "draft", "waiting_approval", "approved", "ordered", "arrived", "used", "cancelled":
		return true
	}
	return false
}

func validatePartsTransition(from, to string, canApprove bool) error {
	if !validPartsStatus(from) || !validPartsStatus(to) {
		return ErrInvalidPartsStatus
	}
	if from == to {
		return nil
	}
	allowed := false
	switch from {
	case "draft":
		allowed = to == "waiting_approval" || to == "cancelled"
	case "waiting_approval":
		allowed = to == "approved" || to == "draft" || to == "cancelled"
	case "approved":
		allowed = to == "ordered" || to == "cancelled"
	case "ordered":
		allowed = to == "arrived" || to == "cancelled"
	case "arrived":
		allowed = to == "used" || to == "cancelled"
	}
	if !allowed {
		return ErrInvalidPartsTransition
	}
	if from == "waiting_approval" && (to == "approved" || to == "cancelled") && !canApprove {
		return ErrPartsApprovalPermission
	}
	return nil
}
