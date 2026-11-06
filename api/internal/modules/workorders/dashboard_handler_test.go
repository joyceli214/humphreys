package workorders

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"humphreys/api/internal/domain"
)

type dashboardStub struct {
	Repository
	data domain.DashboardData
}

func (r *dashboardStub) GetDashboardData(_ context.Context, _ DashboardQueryInput) (domain.DashboardData, error) {
	return r.data, nil
}

// Regression: the handler rebuilt the response in its own struct and dropped
// status_counts, so the live Status Focus block had nothing to choose from.
func TestDashboardHandlerReturnsStatusCounts(t *testing.T) {
	repo := &dashboardStub{data: domain.DashboardData{
		StatusCounts: []domain.DashboardStatusCount{
			{StatusID: 3, Status: "Finished", StatusGroup: "staged", Count: 4},
			{StatusID: 7, Status: "Waiting for pickup", StatusGroup: "staged", Count: 2},
		},
	}}
	router := partsAuditRouter(t, repo)
	res := partsAuditRequest(t, router, http.MethodGet, "/work-orders/dashboard?range=90d", "", []string{permRead})
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", res.Code, res.Body.String())
	}
	var body struct {
		StatusCounts []domain.DashboardStatusCount `json:"status_counts"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.StatusCounts) != 2 || body.StatusCounts[1].Status != "Waiting for pickup" || body.StatusCounts[0].Count != 4 {
		t.Fatalf("status_counts = %+v", body.StatusCounts)
	}
}

func TestDashboardHandlerStatusCountsIsArrayWhenEmpty(t *testing.T) {
	router := partsAuditRouter(t, &dashboardStub{})
	res := partsAuditRequest(t, router, http.MethodGet, "/work-orders/dashboard", "", []string{permRead})
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", res.Code, res.Body.String())
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(res.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if string(raw["status_counts"]) != "[]" {
		t.Fatalf("status_counts = %s, want []", raw["status_counts"])
	}
}
