package workorders

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/modules/aisettings"
	authsecurity "humphreys/api/internal/modules/auth/security"

	"github.com/gin-gonic/gin"
	"github.com/jellydator/ttlcache/v3"
)

func TestAIPromptsExcludeLabourDiscount(t *testing.T) {
	repairLogs := []domain.RepairLog{{Details: "Replaced the power supply and tested operation"}}
	builders := []struct {
		name  string
		build func(domain.WorkOrderDetail) string
	}{
		{"summary", func(item domain.WorkOrderDetail) string {
			return buildWorkOrderAISummaryPrompt(aisettings.DefaultWorkOrderSummaryPrompt, item, repairLogs, nil)
		}},
		{"markdown context", func(item domain.WorkOrderDetail) string {
			return buildAIMarkdownWorkOrderContext(item, repairLogs, nil)
		}},
		{"work done", func(item domain.WorkOrderDetail) string {
			return buildWorkDoneFromRepairLogsPrompt(aisettings.DefaultWorkDonePrompt, repairLogs)
		}},
		{"direct generation", func(item domain.WorkOrderDetail) string {
			return buildAIMarkdownPrompt("work_done", "Describe the repair", "", nil, repairLogs, nil)
		}},
	}
	for _, field := range []string{"problem_description", "work_done", "repair_log"} {
		builders = append(builders, struct {
			name  string
			build func(domain.WorkOrderDetail) string
		}{"markdown " + field, func(item domain.WorkOrderDetail) string {
			return buildAIMarkdownPrompt(field, "Proofread these notes", "Existing notes", &item, repairLogs, nil)
		}})
	}

	for _, kind := range []string{"amount", "percent"} {
		t.Run(kind, func(t *testing.T) {
			value := 37.42
			if kind == "percent" {
				value = 18.71
			}
			item := domain.WorkOrderDetail{
				ReferenceID:          123,
				PartsTotal:           discountPtr(80.0),
				LabourTotal:          discountPtr(200.0),
				DeliveryTotal:        discountPtr(25.0),
				Deposit:              10,
				LabourDiscountType:   &kind,
				LabourDiscountValue:  &value,
				LabourDiscountAmount: 37.42,
			}
			totals := CalculateTotals(item)
			withoutDiscount := item
			withoutDiscount.LabourDiscountType = nil
			withoutDiscount.LabourDiscountValue = nil
			withoutDiscount.LabourDiscountAmount = 0
			for _, builder := range builders {
				t.Run(builder.name, func(t *testing.T) {
					prompt := builder.build(item)
					for _, forbidden := range []string{"discount", "labour (net):", "subtotal:", "hst:", "- total:", "payable:"} {
						if strings.Contains(strings.ToLower(prompt), forbidden) {
							t.Errorf("prompt contains removed field %q", forbidden)
						}
					}
					for _, amount := range []float64{value, totals.LabourDiscount, totals.NetLabour, totals.Subtotal, totals.HST, totals.Total, totals.Payable} {
						if text := fmt.Sprintf("%.2f", amount); strings.Contains(prompt, text) {
							t.Errorf("prompt contains discount or derived amount %q", text)
						}
					}
					if prompt != builder.build(withoutDiscount) {
						t.Error("labour discount changes the prompt")
					}
					if builder.name == "summary" {
						for _, kept := range []string{"- Parts Total: 80.00 CAD", "- Labour Total: 200.00 CAD", "- Delivery Total: 25.00 CAD", "- Deposit: 10.00"} {
							if !strings.Contains(prompt, kept) {
								t.Errorf("prompt missing retained field %q", kept)
							}
						}
					}
				})
			}
		})
	}
}

func TestAISummaryCacheKey(t *testing.T) {
	if aiSummaryCacheKey(123, true) == aiSummaryCacheKey(123, false) {
		t.Error("cache key must distinguish sensitive access")
	}
	for _, sensitive := range []bool{false, true} {
		if aiSummaryCacheKey(123, sensitive) == aiSummaryCacheKey(456, sensitive) {
			t.Error("cache key must distinguish work orders")
		}
	}
}

func TestHasSensitiveAccess(t *testing.T) {
	for _, tc := range []struct {
		name   string
		claims any
		want   bool
	}{
		{"missing claims", nil, false},
		{"nil claims", (*authsecurity.Claims)(nil), false},
		{"invalid claims", "invalid", false},
		{"empty scope", &authsecurity.Claims{}, false},
		{"read only", &authsecurity.Claims{Scope: []string{"work_orders_sensitive:read"}}, false},
		{"regular update", &authsecurity.Claims{Scope: []string{"work_orders:update"}}, false},
		{"similar scope", &authsecurity.Claims{Scope: []string{"work_orders_sensitive:update_extra"}}, false},
		{"sensitive update", &authsecurity.Claims{Scope: []string{"work_orders_sensitive:update"}}, true},
		{"multiple scopes", &authsecurity.Claims{Scope: []string{"work_orders:read", "work_orders_sensitive:update", "work_orders:update"}}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			if tc.claims != nil {
				c.Set("auth_claims", tc.claims)
			}
			if got := hasSensitiveAccess(c); got != tc.want {
				t.Errorf("hasSensitiveAccess = %t; want %t", got, tc.want)
			}
		})
	}
}

func TestGenerateAISummaryUsesAccessAwareCache(t *testing.T) {
	cache := ttlcache.New[string, aiSummaryCacheItem]()
	cache.Set("work-order:123", aiSummaryCacheItem{Summary: "legacy shared summary"}, ttlcache.DefaultTTL)
	for _, sensitive := range []bool{false, true} {
		cache.Set(aiSummaryCacheKey(123, sensitive), aiSummaryCacheItem{
			Summary:     fmt.Sprintf("summary for sensitive=%t", sensitive),
			Model:       "cached-model",
			GeneratedAt: "2026-10-13T00:00:00Z",
		}, ttlcache.DefaultTTL)
	}
	h := &Handler{aiSummaryCache: cache}
	for _, sensitive := range []bool{false, true} {
		t.Run(fmt.Sprintf("sensitive=%t", sensitive), func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/123/ai-summary", nil)
			c.Params = gin.Params{{Key: "reference_id", Value: "123"}}
			if sensitive {
				c.Set("auth_claims", &authsecurity.Claims{Scope: []string{"work_orders_sensitive:update"}})
			}
			h.GenerateAISummary(c)
			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d; body = %s", recorder.Code, recorder.Body.String())
			}
			var response map[string]string
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if want := fmt.Sprintf("summary for sensitive=%t", sensitive); response["summary"] != want {
				t.Errorf("summary = %q; want %q", response["summary"], want)
			}
			if response["model"] != "cached-model" || response["generated_at"] != "2026-10-13T00:00:00Z" {
				t.Errorf("unexpected cached metadata: %v", response)
			}
		})
	}
}
