package fixture

import (
	"database/sql"
	"math"
	"testing"
)

// open returns a read-only handle on the cached fixture, pinned to UTC for the
// same reason the product's connector is: DATE_TRUNC over a timestamp buckets
// in the session zone, so a host in IST would otherwise put January's first
// hours in December and every month-grain assertion below would be off by one
// bucket on that machine and not on CI.
func open(t *testing.T) *sql.DB {
	t.Helper()
	p, err := Cached()
	if err != nil {
		t.Fatalf("build fixture: %v", err)
	}
	db, err := sql.Open("duckdb", p+"?access_mode=read_only&TimeZone=UTC")
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func scalarInt(t *testing.T, db *sql.DB, q string) int64 {
	t.Helper()
	var v int64
	if err := db.QueryRow(q).Scan(&v); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return v
}

func scalarFloat(t *testing.T, db *sql.DB, q string) float64 {
	t.Helper()
	var v float64
	if err := db.QueryRow(q).Scan(&v); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return v
}

// TestGroundTruth re-derives every constant in truth.go against the fixture.
//
// This is the guard that lets the conformance suite hardcode numbers at all.
// Regenerating the CSVs changes the data; without this test that change would
// surface as a *provider* failing conformance — a model blamed for a fixture
// edit. With it, the break lands here, in the package that owns the data, with
// the correct value printed.
func TestGroundTruth(t *testing.T) {
	db := open(t)

	t.Run("counts", func(t *testing.T) {
		for _, c := range []struct {
			name string
			sql  string
			want int64
		}{
			{"CountOrderItems", `SELECT count(*) FROM order_items`, CountOrderItems},
			{"CountOrderItems2023", `SELECT count(*) FROM order_items WHERE year(created_at) = 2023`, CountOrderItems2023},
			{"CountUsers", `SELECT count(*) FROM users`, CountUsers},
			{"CountProducts", `SELECT count(*) FROM products`, CountProducts},
			{"CountOrders", `SELECT count(*) FROM orders`, CountOrders},
			{"CountEvents", `SELECT count(*) FROM events`, CountEvents},
			{"CountAnonymousEvents", `SELECT count(*) FROM events WHERE user_id IS NULL`, CountAnonymousEvents},
			{"DistinctProductCategories", `SELECT count(DISTINCT category) FROM products`, DistinctProductCategories},
			{"DistinctProductDepartments", `SELECT count(DISTINCT department) FROM products`, DistinctProductDepartments},
			{"TotalItemsOrdered", `SELECT sum(num_of_item) FROM orders`, TotalItemsOrdered},
			{"TotalItemsOrderedFannedOut", `SELECT sum(o.num_of_item) FROM orders o JOIN order_items oi ON o.order_id = oi.order_id`, TotalItemsOrderedFannedOut},
		} {
			if got := scalarInt(t, db, c.sql); got != c.want {
				t.Errorf("%s = %d, truth.go says %d\n  %s", c.name, got, c.want, c.sql)
			}
		}
	})

	t.Run("sums", func(t *testing.T) {
		for _, c := range []struct {
			name string
			sql  string
			want float64
			tol  float64
		}{
			{"TotalSalePrice", `SELECT sum(sale_price) FROM order_items`, TotalSalePrice, SumTolerance},
			{"TotalSalePrice2023", `SELECT sum(sale_price) FROM order_items WHERE year(created_at) = 2023`, TotalSalePrice2023, SumTolerance},
			{"NetSalePrice2023", `SELECT sum(sale_price) FROM order_items
				WHERE status NOT IN ('Cancelled', 'Returned')
				  AND created_at >= '2023-01-01' AND created_at < '2024-01-01'`, NetSalePrice2023, SumTolerance},
			{"AvgSalePrice2023", `SELECT avg(sale_price) FROM order_items WHERE year(created_at) = 2023`, AvgSalePrice2023, AvgTolerance},
		} {
			got := scalarFloat(t, db, c.sql)
			if math.Abs(got-c.want) > c.tol {
				t.Errorf("%s = %.6f, truth.go says %.6f (tolerance %g)\n  %s", c.name, got, c.want, c.tol, c.sql)
			}
		}
	})
}

// The tests below assert the *properties* the checks depend on, separately from
// the exact figures. A property test says what the fixture is for; a ground
// truth only says what it currently contains. Both are needed: regenerate the
// data at a different scale and the numbers move, but every property here must
// survive or a verification check silently stops having a subject.

// The filter-literal check exists because a model that guesses 'cancelled' for
// a column storing 'Cancelled' silently returns a bigger number, not an error.
// That is only demonstrable if the fixture stores capitalised statuses AND has
// enough excluded rows for the mistake to move the total.
func TestStatusCasingIsMaterial(t *testing.T) {
	db := open(t)

	const correct = `SELECT sum(sale_price) FROM order_items
		WHERE status NOT IN ('Cancelled', 'Returned')
		  AND created_at >= '2023-01-01' AND created_at < '2024-01-01'`
	const wrongCase = `SELECT sum(sale_price) FROM order_items
		WHERE status NOT IN ('cancelled', 'returned')
		  AND created_at >= '2023-01-01' AND created_at < '2024-01-01'`

	good, bad := scalarFloat(t, db, correct), scalarFloat(t, db, wrongCase)
	if good == bad {
		t.Fatal("lower-casing the status literals changed nothing — the fixture no longer demonstrates the bug the filter-literal check catches")
	}
	overstatement := (bad - good) / good * 100
	if overstatement < 5 {
		t.Errorf("case mismatch overstates 2023 revenue by only %.1f%%; too small to be a convincing demonstration", overstatement)
	}
	t.Logf("correct %.2f vs wrong-case %.2f — a %.1f%% overstatement", good, bad, overstatement)

	// And the casing is what we think it is, not merely inconsistent.
	rows, err := db.Query(`SELECT DISTINCT status FROM order_items ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		if s == "" || s[0] < 'A' || s[0] > 'Z' {
			t.Errorf("status %q is not capitalised", s)
		}
	}
}

// The join-loss check needs rows that a join silently discards.
func TestEventsHaveAnonymousSessions(t *testing.T) {
	db := open(t)
	total := scalarInt(t, db, `SELECT count(*) FROM events`)
	kept := scalarInt(t, db, `SELECT count(*) FROM events e JOIN users u ON e.user_id = u.id`)
	if kept >= total {
		t.Fatal("events JOIN users kept every row — nothing for the join-loss check to detect")
	}
	lost := float64(total-kept) / float64(total) * 100
	if lost < 5 {
		t.Errorf("join drops only %.1f%% of events; too small to be detectable", lost)
	}
	t.Logf("%d of %d events survive the join to users (%.0f%% dropped)", kept, total, lost)

	// The loss must come from NULL user_id, not from dangling references. An
	// orphaned foreign key would be a broken fixture wearing a useful property
	// as a disguise.
	orphans := scalarInt(t, db, `SELECT count(*) FROM events e
		LEFT JOIN users u ON e.user_id = u.id
		WHERE e.user_id IS NOT NULL AND u.id IS NULL`)
	if orphans != 0 {
		t.Errorf("%d events reference a user that does not exist; referential integrity is broken", orphans)
	}
}

// The fan-out check needs a one-to-many join that multiplies an order-level
// measure. A fixture where every order has exactly one line would let the bug
// through unnoticed.
func TestOrdersFanOutToItems(t *testing.T) {
	db := open(t)
	multi := scalarInt(t, db, `SELECT count(*) FROM orders WHERE num_of_item > 1`)
	if multi == 0 {
		t.Fatal("every order has exactly one item — the fan-out check has no subject")
	}
	honest := scalarInt(t, db, `SELECT sum(num_of_item) FROM orders`)
	inflated := scalarInt(t, db, `SELECT sum(o.num_of_item) FROM orders o JOIN order_items oi ON o.order_id = oi.order_id`)
	if inflated <= honest {
		t.Fatalf("summing across the join gave %d, not more than the true %d", inflated, honest)
	}
	t.Logf("%d of %d orders are multi-line; the join inflates sum(num_of_item) from %d to %d",
		multi, CountOrders, honest, inflated)

	// num_of_item must actually equal the line count, or it is decoration.
	mismatched := scalarInt(t, db, `SELECT count(*) FROM (
		SELECT o.order_id FROM orders o
		JOIN order_items oi ON o.order_id = oi.order_id
		GROUP BY o.order_id, o.num_of_item
		HAVING count(*) <> o.num_of_item)`)
	if mismatched != 0 {
		t.Errorf("%d orders have num_of_item disagreeing with their line count", mismatched)
	}
}

// Period questions ("monthly revenue", "was December down?") need every month
// populated. A single empty month turns a trend chart into a cliff and makes
// the period-normalization check fire on an artifact of the fixture rather than
// on anything real.
func TestEveryMonthHasOrders(t *testing.T) {
	db := open(t)
	rows, err := db.Query(`SELECT date_trunc('month', created_at) AS m, count(*)
		FROM order_items GROUP BY 1 ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var m any
		var c int64
		if err := rows.Scan(&m, &c); err != nil {
			t.Fatal(err)
		}
		if c == 0 {
			t.Errorf("month %v is empty", m)
		}
		n++
	}
	// Three whole calendar years, 2023 through 2025.
	if n != 36 {
		t.Fatalf("order_items span %d months; the fixture is meant to cover 36", n)
	}
	if got := scalarInt(t, db, `SELECT count(DISTINCT month(created_at)) FROM order_items WHERE year(created_at) = 2023`); got != 12 {
		t.Errorf("2023 has %d distinct months, want 12", got)
	}
}

// Enum-like columns must stay under the profiler's low-cardinality ceiling
// (warehouse.lowCardinalityCeiling, 50) or their values are never enumerated
// and the filter-literal check degrades to "skipped" — the silent way this
// fixture could stop testing anything.
func TestEnumColumnsStayEnumLike(t *testing.T) {
	db := open(t)
	for _, c := range []struct {
		col  string
		want int64
	}{
		{`SELECT count(DISTINCT status) FROM order_items`, 5},
		{`SELECT count(DISTINCT status) FROM orders`, 5},
		{`SELECT count(DISTINCT country) FROM users`, 6},
		{`SELECT count(DISTINCT traffic_source) FROM users`, 4},
		{`SELECT count(DISTINCT category) FROM products`, DistinctProductCategories},
		{`SELECT count(DISTINCT department) FROM products`, DistinctProductDepartments},
	} {
		got := scalarInt(t, db, c.col)
		if got != c.want {
			t.Errorf("%s = %d, want %d", c.col, got, c.want)
		}
		if got > 50 {
			t.Errorf("%s = %d exceeds the profiler's low-cardinality ceiling", c.col, got)
		}
	}
}

// Every foreign key resolves. Referential integrity is not decoration here: the
// join-loss check reports orphans, so orphans we did not intend would read as a
// true positive and quietly redefine what the check is being tested against.
func TestReferentialIntegrity(t *testing.T) {
	db := open(t)
	for _, c := range []struct{ name, sql string }{
		{"order_items.order_id -> orders", `SELECT count(*) FROM order_items oi LEFT JOIN orders o ON oi.order_id = o.order_id WHERE o.order_id IS NULL`},
		{"order_items.user_id -> users", `SELECT count(*) FROM order_items oi LEFT JOIN users u ON oi.user_id = u.id WHERE u.id IS NULL`},
		{"order_items.product_id -> products", `SELECT count(*) FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE p.id IS NULL`},
		{"orders.user_id -> users", `SELECT count(*) FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE u.id IS NULL`},
		{"products.distribution_center_id -> distribution_centers", `SELECT count(*) FROM products p LEFT JOIN distribution_centers d ON p.distribution_center_id = d.id WHERE d.id IS NULL`},
		{"inventory_items.product_id -> products", `SELECT count(*) FROM inventory_items i LEFT JOIN products p ON i.product_id = p.id WHERE p.id IS NULL`},
	} {
		if got := scalarInt(t, db, c.sql); got != 0 {
			t.Errorf("%s: %d dangling rows", c.name, got)
		}
	}
}

// Lifecycle timestamps must agree with the status they describe. A Cancelled
// row with a delivery date is not a harmless inconsistency — it is the kind of
// thing a reader finds, and once they find one they stop trusting the rest.
func TestLifecycleTimestampsAgreeWithStatus(t *testing.T) {
	db := open(t)
	for _, c := range []struct{ name, sql string }{
		{"Cancelled rows have no shipment", `SELECT count(*) FROM order_items WHERE status = 'Cancelled' AND shipped_at IS NOT NULL`},
		{"Cancelled rows have no delivery", `SELECT count(*) FROM order_items WHERE status = 'Cancelled' AND delivered_at IS NOT NULL`},
		{"Processing rows have not shipped", `SELECT count(*) FROM order_items WHERE status = 'Processing' AND shipped_at IS NOT NULL`},
		{"Complete rows have a delivery", `SELECT count(*) FROM order_items WHERE status = 'Complete' AND delivered_at IS NULL`},
		{"Returned rows have a return date", `SELECT count(*) FROM order_items WHERE status = 'Returned' AND returned_at IS NULL`},
		{"returns follow deliveries", `SELECT count(*) FROM order_items WHERE returned_at IS NOT NULL AND returned_at <= delivered_at`},
		{"deliveries follow shipments", `SELECT count(*) FROM order_items WHERE delivered_at IS NOT NULL AND delivered_at <= shipped_at`},
		{"shipments follow the order", `SELECT count(*) FROM order_items WHERE shipped_at IS NOT NULL AND shipped_at < created_at`},
		{"orders precede nothing they contain", `SELECT count(*) FROM orders o JOIN order_items oi ON o.order_id = oi.order_id WHERE oi.created_at < o.created_at`},
		{"users exist before they order", `SELECT count(*) FROM orders o JOIN users u ON o.user_id = u.id WHERE o.created_at < u.created_at`},
	} {
		if got := scalarInt(t, db, c.sql); got != 0 {
			t.Errorf("%s: %d violating rows", c.name, got)
		}
	}
}

// Cached must hand back the same file rather than rebuilding, and Build must
// produce an independent one. Getting this backwards would either make the
// suite slow or let one test's writes reach another's fixture.
func TestCachedIsStableAndBuildIsNot(t *testing.T) {
	a, err := Cached()
	if err != nil {
		t.Fatal(err)
	}
	b, err := Cached()
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Errorf("Cached returned two paths: %s and %s", a, b)
	}
	fresh, err := Build(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if fresh == a {
		t.Error("Build returned the shared cache entry; tests that write to it would corrupt every other suite")
	}
}
