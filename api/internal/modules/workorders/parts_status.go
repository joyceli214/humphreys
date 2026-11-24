package workorders

import (
	"errors"

	"humphreys/api/internal/domain"
)

var ErrInvalidPartsTransition = errors.New("invalid parts status transition")
var ErrPartsApprovalPermission = errors.New("parts_purchase_requests:approve permission required")

var ErrPartsCostLocked = errors.New("parts_purchase_requests:approve permission required to change price or quantity after approval")

// partsStatusNeedsApprove: creating a request directly in any status other than
// draft / waiting_approval needs the approve permission.
func partsStatusNeedsApprove(status string) bool {
	return status != "draft" && status != "waiting_approval"
}

// partsAfterApproval is the "after approval" rule used by the audit log.
func partsAfterApproval(item domain.PartsPurchaseRequest) bool {
	return item.ApprovedAt != nil || item.Status == "approved"
}

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
	case "used":
		allowed = to == "cancelled"
	}
	if !allowed {
		return ErrInvalidPartsTransition
	}
	if from == "waiting_approval" && (to == "approved" || to == "cancelled") && !canApprove {
		return ErrPartsApprovalPermission
	}
	return nil
}
