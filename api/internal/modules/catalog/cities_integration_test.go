package catalog

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Match the workorders integration-test pattern: create and drop a private
// database, never migrate the supplied administrative database. Local hosts only.
func citiesTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("CITIES_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set CITIES_TEST_DATABASE_URL to a local PostgreSQL admin connection to run integration tests")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid CITIES_TEST_DATABASE_URL")
	}
	localHost := func(host string) bool {
		return host == "localhost" || host == "127.0.0.1" || host == "::1" || strings.HasPrefix(host, "/")
	}
	if !localHost(cfg.ConnConfig.Host) {
		t.Fatal("CITIES_TEST_DATABASE_URL must use a local PostgreSQL host")
	}
	for _, fallback := range cfg.ConnConfig.Fallbacks {
		if !localHost(fallback.Host) {
			t.Fatal("CITIES_TEST_DATABASE_URL fallback must use a local PostgreSQL host")
		}
	}
	ctx := context.Background()
	admin, err := pgx.ConnectConfig(ctx, cfg.ConnConfig.Copy())
	if err != nil {
		t.Fatal("could not connect to local integration-test PostgreSQL")
	}
	t.Cleanup(func() { _ = admin.Close(ctx) })
	database := "cities_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{database}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP DATABASE "+pgx.Identifier{database}.Sanitize()); err != nil {
			t.Error(err)
		}
	})
	cfg.ConnConfig.Database = database
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal("could not create local integration-test pool")
	}
	t.Cleanup(pool.Close)
	migration, err := os.ReadFile("../../../migrations/039_cities.sql")
	if err != nil {
		t.Fatal(err)
	}
	// The real generated migration must be safe to apply twice.
	for range 2 {
		if _, err := pool.Exec(ctx, string(migration)); err != nil {
			t.Fatal(err)
		}
	}
	return pool
}

func TestCitiesPostgres(t *testing.T) {
	pool := citiesTestDB(t)
	ctx := context.Background()
	service := NewService(NewRepository(pool))
	var provinces, cities int
	if err := pool.QueryRow(ctx, `SELECT count(DISTINCT province), count(*) FROM public.cities`).Scan(&provinces, &cities); err != nil {
		t.Fatal(err)
	}
	if provinces != 13 || cities < 4900 {
		t.Fatalf("unexpected seed size: %d provinces, %d cities", provinces, cities)
	}
	ontario, err := service.ListCities(ctx, " Ontario ", "")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, city := range ontario {
		if city.Label == "Scarborough" {
			found = true
		}
	}
	if !found {
		t.Fatal("Ontario list is missing Scarborough")
	}
	filtered, err := service.ListCities(ctx, " oNTArio ", " SCAR ")
	if err != nil || len(filtered) == 0 || filtered[0].Label != "Scarborough" {
		t.Fatalf("case-insensitive query: %+v, %v", filtered, err)
	}
	for _, city := range filtered {
		if !strings.Contains(strings.ToLower(city.Label), "scar") {
			t.Fatalf("query returned nonmatch: %+v", city)
		}
	}
	first, err := service.CreateCity(ctx, " ontario ", " Picklist Test City ")
	if err != nil {
		t.Fatal(err)
	}
	var storedProvince string
	if err := pool.QueryRow(ctx, `SELECT province FROM public.cities WHERE id = $1`, first.ID).Scan(&storedProvince); err != nil {
		t.Fatal(err)
	}
	if storedProvince != "Ontario" {
		t.Fatalf("lowercase province stored as %q; want canonical Ontario", storedProvince)
	}
	duplicate, err := service.CreateCity(ctx, " ONTARIO ", " PICKLIST TEST CITY ")
	if err != nil || duplicate.ID != first.ID || duplicate.Label != first.Label {
		t.Fatalf("duplicate did not return existing option: %+v, %v", duplicate, err)
	}
	otherProvince, err := service.CreateCity(ctx, "Quebec", "Picklist Test City")
	if err != nil || otherProvince.ID == first.ID {
		t.Fatalf("same name in another province: %+v, %v", otherProvince, err)
	}

	t.Run("literal wildcards and prefix ordering", func(t *testing.T) {
		province := "Picklist Search Test"
		for _, name := range []string{"AA Needle", "Needle Z", `Literal %_\ City`, "Literal XX City"} {
			if _, err := service.CreateCity(ctx, province, name); err != nil {
				t.Fatal(err)
			}
		}
		matches, err := service.ListCities(ctx, province, "needle")
		if err != nil || len(matches) != 2 || matches[0].Label != "Needle Z" || matches[1].Label != "AA Needle" {
			t.Fatalf("prefix ordering: %+v, %v", matches, err)
		}
		for _, query := range []string{"%", "_", `\`} {
			matches, err := service.ListCities(ctx, province, query)
			if err != nil || len(matches) != 1 || matches[0].Label != `Literal %_\ City` {
				t.Fatalf("literal query %q: %+v, %v", query, matches, err)
			}
		}
	})

	t.Run("concurrent duplicates", func(t *testing.T) {
		const count = 8
		var wg sync.WaitGroup
		options := make([]LookupOption, count)
		errs := make([]error, count)
		start := make(chan struct{})
		for i := range count {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				province, name := "Ontario", "Concurrent Picklist City"
				if i%2 == 0 {
					province, name = strings.ToUpper(province), strings.ToUpper(name)
				}
				options[i], errs[i] = service.CreateCity(ctx, province, name)
			}()
		}
		close(start)
		wg.Wait()
		for i := range count {
			if errs[i] != nil || options[i].ID != options[0].ID || options[i].ID == 0 {
				t.Fatalf("concurrent create %d: %+v, %v", i, options[i], errs[i])
			}
		}
	})
}
