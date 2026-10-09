package workorders

import (
	"errors"
	"testing"
)

func TestPartsStatusTransitions(t *testing.T) {
	statuses := []string{"draft", "waiting_approval", "approved", "ordered", "arrived", "used", "cancelled"}
	allowed := map[string]map[string]bool{
		"draft":            {"waiting_approval": true, "cancelled": true},
		"waiting_approval": {"approved": true, "draft": true, "cancelled": true},
		"approved":         {"ordered": true, "cancelled": true},
		"ordered":          {"arrived": true, "cancelled": true},
		"arrived":          {"used": true, "cancelled": true},
		"used":             {"cancelled": true},
	}
	for _, from := range statuses {
		for _, to := range statuses {
			for _, permission := range []bool{false, true} {
				t.Run(from+"/"+to+map[bool]string{false: "/staff", true: "/approver"}[permission], func(t *testing.T) {
					var want error
					if from != to {
						if !allowed[from][to] {
							want = ErrInvalidPartsTransition
						} else if from == "waiting_approval" && (to == "approved" || to == "cancelled") && !permission {
							want = ErrPartsApprovalPermission
						}
					}
					if got := validatePartsTransition(from, to, permission); !errors.Is(got, want) {
						t.Fatalf("got %v, want %v", got, want)
					}
				})
			}
		}
	}
	for _, pair := range [][2]string{{"invalid", "draft"}, {"draft", "invalid"}, {"invalid", "invalid"}} {
		if got := validatePartsTransition(pair[0], pair[1], true); !errors.Is(got, ErrInvalidPartsStatus) {
			t.Fatalf("invalid status: got %v", got)
		}
	}
}
