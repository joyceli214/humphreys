package workorders

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
)

// aiToolsStub is a configurable Repository used by the AI Tools handler tests.
// It embeds Repository so only the methods the AI Tools endpoints call need to
// be implemented; everything else panics if unexpectedly reached.
type aiToolsStub struct {
	Repository
	statuses   []AIStatusOption
	locations  []AILocationOption
	stale      []AIStaleCandidate
	details    map[int]domain.WorkOrderDetail
	repairLogs map[int][]domain.RepairLog

	applyErr   map[int]error                  // per-reference apply failure
	appliedOps map[int][]massUpdateResolvedOp // records what apply received
	applyCalls []int
	// appliedExpected records the expected updated_at apply received per job.
	appliedExpected map[int]*time.Time

	searchRows  []AISearchRow
	searchTotal int
	lastSearch  *aiResolvedSearchFilters // records what the search handler sent
}

func (r *aiToolsStub) AISearch(_ context.Context, f aiResolvedSearchFilters) ([]AISearchRow, int, error) {
	r.lastSearch = &f
	return r.searchRows, r.searchTotal, nil
}

func (r *aiToolsStub) AIStatuses(context.Context) ([]AIStatusOption, error) {
	return r.statuses, nil
}

func (r *aiToolsStub) AILocations(context.Context) ([]AILocationOption, error) {
	return r.locations, nil
}

func (r *aiToolsStub) AIStaleCandidates(context.Context) ([]AIStaleCandidate, error) {
	return r.stale, nil
}

func (r *aiToolsStub) GetWorkOrderDetail(_ context.Context, referenceID int) (domain.WorkOrderDetail, error) {
	detail, ok := r.details[referenceID]
	if !ok {
		return domain.WorkOrderDetail{}, ErrWorkOrderNotFound
	}
	return detail, nil
}

func (r *aiToolsStub) ListRepairLogs(_ context.Context, referenceID int) ([]domain.RepairLog, error) {
	return r.repairLogs[referenceID], nil
}

func (r *aiToolsStub) ApplyMassUpdateJob(_ context.Context, referenceID int, expectedUpdatedAt *time.Time, ops []massUpdateResolvedOp, _ string) ([]string, error) {
	if r.appliedOps == nil {
		r.appliedOps = map[int][]massUpdateResolvedOp{}
	}
	if r.appliedExpected == nil {
		r.appliedExpected = map[int]*time.Time{}
	}
	r.appliedOps[referenceID] = ops
	r.appliedExpected[referenceID] = expectedUpdatedAt
	r.applyCalls = append(r.applyCalls, referenceID)
	if err := r.applyErr[referenceID]; err != nil {
		return nil, err
	}
	applied := make([]string, 0, len(ops))
	for _, op := range ops {
		applied = append(applied, op.Op)
	}
	return applied, nil
}

// aiToolsRouter wires the AI Tools routes behind the same auth middleware the
// real server uses, with a handler whose HTTP client points at the mock LLM.
func aiToolsRouter(t *testing.T, repo Repository) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("", middleware.Auth("test-secret"))
	h := &Handler{service: NewService(repo), httpClient: &http.Client{}}
	RegisterAIToolsRoutes(group, h)
	return router
}

// mockLLMServer returns an httptest server that answers the OpenRouter chat
// endpoint with the given text as the single choice's content. Tests point
// OPENROUTER_BASE_URL at it.
func mockLLMServer(t *testing.T, content string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model": "mock-model",
			"choices": []map[string]any{
				{"message": map[string]any{"content": content}},
			},
		})
	}))
	t.Cleanup(srv.Close)
	return srv
}

// useMockLLM points the OpenRouter client at srv and supplies a dummy API key so
// the handlers consider AI configured.
func useMockLLM(t *testing.T, srv *httptest.Server) {
	t.Helper()
	t.Setenv("OPENROUTER_API_KEY", "test-key")
	t.Setenv("OPENROUTER_BASE_URL", srv.URL)
	t.Setenv("OPENROUTER_FALLBACK_MODEL", "none")
}

func ptrFloat(v float64) *float64 { return &v }
func ptrStr(v string) *string     { return &v }
