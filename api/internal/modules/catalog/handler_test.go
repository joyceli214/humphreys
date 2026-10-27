package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCityHandlers(t *testing.T) {
	want := LookupOption{ID: 42, Label: "Scarborough"}
	repo := &cityTestRepository{
		listCities: func(_ context.Context, province, query string) ([]LookupOption, error) {
			if province != "Ontario" || query != "scar" {
				t.Fatalf("unexpected list arguments: %q, %q", province, query)
			}
			return []LookupOption{want}, nil
		},
		createCity: func(_ context.Context, province, name string) (LookupOption, error) {
			if province != "Ontario" || name != "Scarborough" {
				t.Fatalf("unexpected create arguments: %q, %q", province, name)
			}
			return want, nil
		},
	}
	h := NewWithService(NewService(repo))
	router := gin.New()
	router.GET("/catalog/cities", h.ListCities)
	router.POST("/catalog/cities", h.CreateCity)
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{
		{http.MethodGet, "/catalog/cities", "", http.StatusBadRequest},
		{http.MethodGet, "/catalog/cities?province=%20", "", http.StatusBadRequest},
		{http.MethodGet, "/catalog/cities?province=%20Ontario%20&q=scar", "", http.StatusOK},
		{http.MethodPost, "/catalog/cities", `{"province":" Ontario ","name":" Scarborough "}`, http.StatusCreated},
		{http.MethodPost, "/catalog/cities", `{"province":"Ontario","label":"Scarborough"}`, http.StatusCreated},
		{http.MethodPost, "/catalog/cities", `{"province":"Ontario","name":"Scarborough","label":"Ignored"}`, http.StatusCreated},
		{http.MethodPost, "/catalog/cities", `{"province":"Ontario","name":" "}`, http.StatusBadRequest},
		{http.MethodPost, "/catalog/cities", `{"province":" ","name":"Scarborough"}`, http.StatusBadRequest},
		{http.MethodPost, "/catalog/cities", `{"province":"Ontario"}`, http.StatusBadRequest},
		{http.MethodPost, "/catalog/cities", `{`, http.StatusBadRequest},
	} {
		t.Run(tc.method+tc.path+tc.body, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(response, request)
			if response.Code != tc.status {
				t.Fatalf("got %d: %s; want %d", response.Code, response.Body, tc.status)
			}
			if tc.status == http.StatusCreated {
				var got LookupOption
				if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil || got != want {
					t.Fatalf("unexpected create response: %s, %v", response.Body, err)
				}
			}
			if tc.status == http.StatusOK {
				var got struct {
					Items []LookupOption `json:"items"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil || len(got.Items) != 1 || got.Items[0] != want {
					t.Fatalf("unexpected list response: %s, %v", response.Body, err)
				}
			}
		})
	}
}
