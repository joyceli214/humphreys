package catalog

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

// Unused methods deliberately panic through the embedded interface, including
// IsDropdownFrozen: city creation must not depend on managed dropdown settings.
type cityTestRepository struct {
	Repository
	listCities func(context.Context, string, string) ([]LookupOption, error)
	createCity func(context.Context, string, string) (LookupOption, error)
}

func (r *cityTestRepository) ListCities(ctx context.Context, province, query string) ([]LookupOption, error) {
	return r.listCities(ctx, province, query)
}

func (r *cityTestRepository) CreateCity(ctx context.Context, province, name string) (LookupOption, error) {
	return r.createCity(ctx, province, name)
}

func TestListCities(t *testing.T) {
	ctx := context.Background()
	want := []LookupOption{{ID: 42, Label: "Scarborough"}}
	repoErr := errors.New("repository unavailable")
	for _, resultErr := range []error{nil, repoErr} {
		repo := &cityTestRepository{listCities: func(gotCtx context.Context, province, query string) ([]LookupOption, error) {
			if gotCtx != ctx || province != "oNTario" || query != "scar" {
				t.Fatalf("unexpected arguments: province=%q query=%q", province, query)
			}
			return want, resultErr
		}}
		got, err := NewService(repo).ListCities(ctx, " \toNTario\n", " scar ")
		if !reflect.DeepEqual(got, want) || !errors.Is(err, resultErr) {
			t.Fatalf("got %+v, %v; want %+v, %v", got, err, want, resultErr)
		}
	}
	for _, province := range []string{"", " \t\n"} {
		if _, err := NewService(&cityTestRepository{}).ListCities(ctx, province, ""); !errors.Is(err, ErrInvalidCityProvince) {
			t.Fatalf("blank province: %v", err)
		}
	}
}

func TestCreateCity(t *testing.T) {
	ctx := context.Background()
	want := LookupOption{ID: 42, Label: "Scarborough"}
	repoErr := errors.New("repository unavailable")
	for _, resultErr := range []error{nil, repoErr} {
		repo := &cityTestRepository{createCity: func(gotCtx context.Context, province, name string) (LookupOption, error) {
			if gotCtx != ctx || province != "Ontario" || name != "Scarborough" {
				t.Fatalf("unexpected arguments: province=%q name=%q", province, name)
			}
			return want, resultErr
		}}
		got, err := NewService(repo).CreateCity(ctx, " \tOntario\n", " Scarborough ")
		if got != want || !errors.Is(err, resultErr) {
			t.Fatalf("got %+v, %v; want %+v, %v", got, err, want, resultErr)
		}
	}
	for _, tc := range []struct {
		province, name string
		want           error
	}{
		{"", "Scarborough", ErrInvalidCityProvince},
		{" \t\n", "Scarborough", ErrInvalidCityProvince},
		{"Ontario", "", ErrInvalidCityName},
		{"Ontario", " \t\n", ErrInvalidCityName},
	} {
		if _, err := NewService(&cityTestRepository{}).CreateCity(ctx, tc.province, tc.name); !errors.Is(err, tc.want) {
			t.Errorf("province=%q name=%q: got %v, want %v", tc.province, tc.name, err, tc.want)
		}
	}
}
