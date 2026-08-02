// Package gen generates the synthetic retail dataset this project tests and
// demos against.
//
// # Why this exists
//
// Analyst used to test and demo against a 6 MB slice of Google's TheLook
// e-commerce dataset, reached via a Kaggle mirror. Nothing in that chain states
// a licence we could rely on, so the file could not be redistributed with a
// clear conscience — and eight ground-truth figures in the provider conformance
// suite were computed against it, which meant the suite went away with the
// data.
//
// Everything here is invented. The output is ours, licensed with the repository,
// and — because we generate it — we can *guarantee* the properties the tests and
// the demo depend on rather than hoping a third-party dataset keeps containing
// them:
//
//   - every month of every year covered has orders, so "monthly trend" is never
//     accidentally sparse
//   - statuses are capitalised ('Cancelled', not 'cancelled'), so a model that
//     guesses the casing produces a materially different number — the failure
//     the filter-literal check exists to catch
//   - some events have no user, so a join to users silently drops rows
//   - orders fan out to multiple order_items, so summing an order-level column
//     across the join inflates it
//   - "revenue" is genuinely ambiguous — gross vs. net of cancellations — which
//     is the refusal path's canonical demo
//
// # Determinism
//
// Output is byte-identical for a given scale. The generator draws from
// math/rand seeded through rand.NewSource, whose stream is frozen by the Go 1
// compatibility promise, and every loop runs in a fixed order. Regenerating the
// committed fixture must produce no diff; if it does, something here changed
// and the ground truths in internal/fixture need re-deriving.
package gen

import (
	"encoding/csv"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// seed is fixed forever. Changing it changes every ground-truth figure in the
// repository, so it is a deliberate, breaking act.
const seed = 20260214

// Start and End bound every timestamp in the dataset, inclusive of start and
// exclusive of end. Three whole calendar years: enough for year-over-year
// questions, complete-month checks, and a "no data yet this year" edge.
var (
	Start = time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC)
	End   = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
)

// Scale sizes the output. Two exist and that is on purpose: `tiny` is committed
// as CSV and loaded by every test, `demo` is generated on demand by
// scripts/setup-sample-data.sh for people who want something to click around in.
type Scale struct {
	Name                string
	Users               int
	Products            int
	DistributionCenters int
	Orders              int
	Events              int
}

var (
	Tiny = Scale{Name: "tiny", Users: 60, Products: 40, DistributionCenters: 4, Orders: 200, Events: 300}
	Demo = Scale{Name: "demo", Users: 1200, Products: 400, DistributionCenters: 6, Orders: 6000, Events: 15000}
)

// ScaleByName resolves a -scale flag.
func ScaleByName(name string) (Scale, error) {
	switch name {
	case "tiny":
		return Tiny, nil
	case "demo":
		return Demo, nil
	}
	return Scale{}, fmt.Errorf("unknown scale %q (want tiny or demo)", name)
}

// --- vocabularies -----------------------------------------------------------
//
// People are named after computing and mathematics figures. That is a house
// convention (see internal/warehouse/conformance/testdata) and it has a
// practical point: nobody can mistake this for real customer data.

var firstNames = []string{
	"Ada", "Alan", "Barbara", "Blaise", "Chandra", "Donald", "Edsger", "Emmy",
	"Frances", "Grace", "Haskell", "Ingrid", "John", "Katherine", "Leslie",
	"Maryam", "Niklaus", "Olga", "Peter", "Radia", "Sofya", "Tony", "Ursula",
	"Vint", "Wanda", "Xiaowei", "Yukihiro", "Zohar",
}

var lastNames = []string{
	"Lovelace", "Turing", "Liskov", "Pascal", "Kaimal", "Knuth", "Dijkstra",
	"Noether", "Allen", "Hopper", "Curry", "Daubechies", "Backus", "Johnson",
	"Lamport", "Mirzakhani", "Wirth", "Ladyzhenskaya", "Naur", "Perlman",
	"Kovalevskaya", "Hoare", "Franklin", "Cerf", "Rutkowska", "Chen",
	"Matsumoto", "Manna",
}

// Countries are facts, not inventions. Six keeps the column enum-like, which is
// what makes it useful for the filter-literal check.
var countries = []string{"Australia", "Brazil", "Canada", "Germany", "India", "United States"}

var cities = map[string][]string{
	"Australia":     {"Adelaide", "Brisbane", "Melbourne"},
	"Brazil":        {"Belo Horizonte", "Curitiba", "Recife"},
	"Canada":        {"Calgary", "Halifax", "Winnipeg"},
	"Germany":       {"Dortmund", "Leipzig", "Stuttgart"},
	"India":         {"Kochi", "Nagpur", "Pune"},
	"United States": {"Boise", "Omaha", "Raleigh"},
}

var trafficSources = []string{"Email", "Organic", "Search", "Social"}

// departmentCategories is the product hierarchy. Categories deliberately repeat
// across departments: that makes "revenue by category" and "revenue by
// department" different questions over the same rows, which is the drill-down
// the dashboards demo.
var departmentCategories = []struct {
	Department string
	Categories []string
}{
	{"Womenswear", []string{"Outerwear", "Denim", "Knitwear", "Dresses", "Footwear"}},
	{"Menswear", []string{"Outerwear", "Denim", "Shirts", "Suits", "Footwear"}},
	{"Kids", []string{"Outerwear", "Denim", "Sleepwear"}},
}

// Invented brands. Any resemblance to a real label is accidental.
var brands = []string{
	"Alder & Vane", "Bright Meridian", "Corvid Supply", "Dunlin Goods",
	"Ember Row", "Fathom Mills", "Grayling", "Halcyon Standard",
}

// categoryNouns keeps product names consistent with their category. This is
// cosmetic and it is worth the twenty lines: the first thing anyone does with a
// sample warehouse is put it on screen, and "Denim — Bright Meridian Sandal"
// reads as a broken dataset even when every number in it is right.
var categoryNouns = map[string][]string{
	"Outerwear": {"Anorak", "Bomber", "Chore Coat", "Field Jacket", "Parka", "Peacoat", "Raincoat", "Trench"},
	"Denim":     {"Slim Jean", "Straight Jean", "Wide Jean", "Denim Jacket", "Denim Skirt", "Overall"},
	"Knitwear":  {"Cardigan", "Crewneck", "Mockneck", "Cable Sweater", "Turtleneck"},
	"Dresses":   {"Poplin Dress", "Shift Dress", "Wrap Dress", "Slip Dress", "Midi Dress"},
	"Shirts":    {"Oxford Shirt", "Henley", "Flannel Shirt", "Camp Shirt", "Linen Shirt"},
	"Suits":     {"Blazer", "Two-Piece Suit", "Waistcoat", "Suit Trouser"},
	"Footwear":  {"Chelsea Boot", "Derby Shoe", "Loafer", "Runner", "Sandal", "Sneaker"},
	"Sleepwear": {"Pyjama Set", "Sleep Shirt", "Robe", "Sleep Short"},
}

// Distribution centres take scientists' names; the cities are real places.
var dcNames = []struct{ Name, City, Country string }{
	{"Noether", "Erlangen", "Germany"},
	{"Ramanujan", "Chennai", "India"},
	{"Hopper", "Arlington", "United States"},
	{"Lovelace", "Nottingham", "United Kingdom"},
	{"Cajal", "Zaragoza", "Spain"},
	{"Bartik", "Omaha", "United States"},
}

// itemStatuses is weighted by the cumulative thresholds in itemStatusCut.
// Capitalisation is load-bearing: a generated predicate that writes
// 'cancelled' matches nothing, and the resulting number is wrong by the value
// of every cancelled row.
var itemStatuses = []string{"Complete", "Shipped", "Processing", "Cancelled", "Returned"}
var itemStatusCut = []float64{0.55, 0.75, 0.85, 0.93, 1.00}

var browsers = []string{"Chrome", "Firefox", "Safari"}
var eventTypes = []string{"home", "department", "product", "cart", "purchase"}

// --- generation -------------------------------------------------------------

// Generate writes the dataset for scale as CSV files into dir.
func Generate(s Scale, dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	r := rand.New(rand.NewSource(seed))

	dcs := genDistributionCenters(s)
	products := genProducts(r, s, dcs)
	users := genUsers(r, s)
	orders, items, inv := genOrders(r, s, users, products)
	events := genEvents(r, s, users)

	for _, t := range []struct {
		name string
		rows [][]string
	}{
		{"distribution_centers", dcs},
		{"products", products},
		{"users", users},
		{"orders", orders},
		{"order_items", items},
		{"inventory_items", inv},
		{"events", events},
	} {
		if err := writeCSV(filepath.Join(dir, t.name+".csv"), t.rows); err != nil {
			return err
		}
	}
	return nil
}

func writeCSV(path string, rows [][]string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create %s: %w", path, err)
	}
	defer f.Close()
	w := csv.NewWriter(f)
	if err := w.WriteAll(rows); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	w.Flush()
	return w.Error()
}

func genDistributionCenters(s Scale) [][]string {
	rows := [][]string{{"id", "name", "city", "country"}}
	for i := 0; i < s.DistributionCenters && i < len(dcNames); i++ {
		d := dcNames[i]
		rows = append(rows, []string{itoa(i + 1), d.Name, d.City, d.Country})
	}
	return rows
}

func genProducts(r *rand.Rand, s Scale, dcs [][]string) [][]string {
	nDC := len(dcs) - 1
	rows := [][]string{{
		"id", "name", "brand", "category", "department",
		"cost", "retail_price", "distribution_center_id",
	}}

	// Walk the hierarchy round-robin so every department and every category is
	// populated at any scale. Random assignment would leave a category empty at
	// tiny scale and quietly break "revenue by category".
	type slot struct{ dept, cat string }
	var slots []slot
	for _, d := range departmentCategories {
		for _, c := range d.Categories {
			slots = append(slots, slot{d.Department, c})
		}
	}

	for i := 0; i < s.Products; i++ {
		sl := slots[i%len(slots)]
		brand := brands[i%len(brands)]
		nouns := categoryNouns[sl.cat]
		noun := nouns[(i/len(slots))%len(nouns)]
		retail := round2(12 + r.Float64()*168)             // $12 – $180
		cost := round2(retail * (0.35 + r.Float64()*0.25)) // 35–60% of retail
		rows = append(rows, []string{
			itoa(i + 1),
			brand + " " + noun,
			brand,
			sl.cat,
			sl.dept,
			ftoa(cost),
			ftoa(retail),
			itoa(1 + r.Intn(nDC)),
		})
	}
	return rows
}

func genUsers(r *rand.Rand, s Scale) [][]string {
	rows := [][]string{{
		"id", "first_name", "last_name", "email", "age",
		"country", "city", "traffic_source", "created_at",
	}}
	for i := 0; i < s.Users; i++ {
		first := firstNames[i%len(firstNames)]
		last := lastNames[(i*3)%len(lastNames)]
		country := countries[i%len(countries)]
		city := cities[country][r.Intn(len(cities[country]))]
		// example.com is reserved by RFC 2606 precisely so that generated
		// addresses cannot reach a real mailbox.
		email := fmt.Sprintf("%s.%s%d@example.com", lower(first), lower(last), i+1)
		rows = append(rows, []string{
			itoa(i + 1), first, last, email,
			itoa(18 + r.Intn(52)),
			country, city,
			trafficSources[r.Intn(len(trafficSources))],
			// Signup precedes the order window, so no order predates its user.
			fmtTime(Start.AddDate(0, 0, -r.Intn(400)-1)),
		})
	}
	return rows
}

// monthlyQuota splits n across every month in [Start, End) with a guaranteed
// floor, so no month is ever empty. Sampling dates uniformly at random would
// leave holes at tiny scale, and a monthly trend with a missing bar is exactly
// the kind of artifact that makes a demo look broken.
func monthlyQuota(n int) []int {
	var months []time.Time
	for t := Start; t.Before(End); t = t.AddDate(0, 1, 0) {
		months = append(months, t)
	}
	const floor = 2
	quota := make([]int, len(months))
	remaining := n - floor*len(months)
	if remaining < 0 {
		remaining = 0
	}
	// Mild year-on-year growth plus a Q4 lift: the shape a retail dataset
	// should have, so seasonality questions have something to find.
	weights := make([]float64, len(months))
	var total float64
	for i, m := range months {
		w := 1.0 + 0.25*float64(m.Year()-Start.Year())
		switch m.Month() {
		case time.November, time.December:
			w *= 1.6
		case time.January, time.February:
			w *= 0.8
		}
		weights[i] = w
		total += w
	}
	assigned := 0
	for i := range months {
		quota[i] = floor + int(float64(remaining)*weights[i]/total)
		assigned += quota[i]
	}
	// Hand any rounding shortfall to the last month rather than dropping rows,
	// so the row counts in the ground truths are exactly n.
	quota[len(quota)-1] += n - assigned
	return quota
}

func monthStarts() []time.Time {
	var months []time.Time
	for t := Start; t.Before(End); t = t.AddDate(0, 1, 0) {
		months = append(months, t)
	}
	return months
}

func genOrders(r *rand.Rand, s Scale, users, products [][]string) (orders, items, inv [][]string) {
	orders = [][]string{{
		"order_id", "user_id", "status", "created_at",
		"shipped_at", "delivered_at", "returned_at", "num_of_item",
	}}
	items = [][]string{{
		"id", "order_id", "user_id", "product_id", "inventory_item_id",
		"status", "created_at", "shipped_at", "delivered_at", "returned_at",
		"sale_price",
	}}
	inv = [][]string{{
		"id", "product_id", "created_at", "sold_at", "cost",
		"product_category", "product_department", "product_distribution_center_id",
	}}

	nUsers := len(users) - 1
	nProducts := len(products) - 1
	months := monthStarts()
	quota := monthlyQuota(s.Orders)

	orderID, itemID := 0, 0
	for mi, m := range months {
		daysInMonth := m.AddDate(0, 1, 0).Sub(m).Hours() / 24
		for k := 0; k < quota[mi]; k++ {
			orderID++
			userID := 1 + r.Intn(nUsers)
			placed := m.Add(time.Duration(r.Float64()*daysInMonth*24*60) * time.Minute).Truncate(time.Second)

			// 1–4 lines per order. Multi-line orders are what make summing an
			// order-level column across the join to order_items inflate.
			lines := 1 + r.Intn(4)
			orderStatus := ""
			for l := 0; l < lines; l++ {
				itemID++
				productID := 1 + r.Intn(nProducts)
				retail, _ := strconv.ParseFloat(products[productID][6], 64)
				// A small, occasionally applied discount: enough that
				// sale_price is not merely a copy of retail_price.
				sale := retail
				if r.Float64() < 0.35 {
					sale = round2(retail * (0.75 + r.Float64()*0.2))
				}
				status := pickStatus(r.Float64())
				if l == 0 {
					orderStatus = status
				}
				shipped, delivered, returned := lifecycle(r, placed, status)
				items = append(items, []string{
					itoa(itemID), itoa(orderID), itoa(userID), itoa(productID), itoa(itemID),
					status, fmtTime(placed), shipped, delivered, returned,
					ftoa(sale),
				})
				cost, _ := strconv.ParseFloat(products[productID][5], 64)
				sold := ""
				if status != "Cancelled" {
					sold = fmtTime(placed)
				}
				inv = append(inv, []string{
					itoa(itemID), itoa(productID),
					fmtTime(placed.AddDate(0, 0, -r.Intn(60)-1)),
					sold, ftoa(cost),
					products[productID][3], products[productID][4], products[productID][7],
				})
			}
			shipped, delivered, returned := lifecycle(r, placed, orderStatus)
			orders = append(orders, []string{
				itoa(orderID), itoa(userID), orderStatus, fmtTime(placed),
				shipped, delivered, returned, itoa(lines),
			})
		}
	}
	return orders, items, inv
}

func pickStatus(x float64) string {
	for i, cut := range itemStatusCut {
		if x < cut {
			return itemStatuses[i]
		}
	}
	return itemStatuses[len(itemStatuses)-1]
}

// lifecycle derives the three optional timestamps from the status, so the
// columns are consistent with it: a Cancelled row never has a delivery date,
// and a Returned row always has one. Nullable timestamps also give the
// null-handling checks something real to find.
func lifecycle(r *rand.Rand, placed time.Time, status string) (shipped, delivered, returned string) {
	switch status {
	case "Processing", "Cancelled":
		return "", "", ""
	case "Shipped":
		return fmtTime(placed.AddDate(0, 0, 1+r.Intn(3))), "", ""
	case "Complete":
		s := placed.AddDate(0, 0, 1+r.Intn(3))
		return fmtTime(s), fmtTime(s.AddDate(0, 0, 1+r.Intn(5))), ""
	case "Returned":
		s := placed.AddDate(0, 0, 1+r.Intn(3))
		d := s.AddDate(0, 0, 1+r.Intn(5))
		return fmtTime(s), fmtTime(d), fmtTime(d.AddDate(0, 0, 2+r.Intn(20)))
	}
	return "", "", ""
}

// genEvents produces clickstream rows, one in five of which has NO user.
//
// That null is deliberate and is the only reason the join-loss check has
// anything to detect here: `events JOIN users` silently drops every anonymous
// session, which is the single commonest way a dashboard number ends up quietly
// too low.
func genEvents(r *rand.Rand, s Scale, users [][]string) [][]string {
	rows := [][]string{{
		"id", "user_id", "session_id", "sequence_number", "created_at",
		"browser", "traffic_source", "event_type", "country",
	}}
	nUsers := len(users) - 1
	months := monthStarts()
	quota := monthlyQuota(s.Events)

	id := 0
	for mi, m := range months {
		daysInMonth := m.AddDate(0, 1, 0).Sub(m).Hours() / 24
		for k := 0; k < quota[mi]; k++ {
			id++
			user := itoa(1 + r.Intn(nUsers))
			if r.Float64() < 0.2 {
				user = "" // anonymous session
			}
			at := m.Add(time.Duration(r.Float64()*daysInMonth*24*60) * time.Minute).Truncate(time.Second)
			rows = append(rows, []string{
				itoa(id), user,
				fmt.Sprintf("s%06d", id/3+1),
				itoa(1 + r.Intn(6)),
				fmtTime(at),
				browsers[r.Intn(len(browsers))],
				trafficSources[r.Intn(len(trafficSources))],
				eventTypes[r.Intn(len(eventTypes))],
				countries[r.Intn(len(countries))],
			})
		}
	}
	return rows
}

// --- small helpers ----------------------------------------------------------

func itoa(i int) string { return strconv.Itoa(i) }

// ftoa always emits two decimals so the CSV is stable and money reads as money.
func ftoa(f float64) string { return strconv.FormatFloat(f, 'f', 2, 64) }

func round2(f float64) float64 {
	v, _ := strconv.ParseFloat(strconv.FormatFloat(f, 'f', 2, 64), 64)
	return v
}

func fmtTime(t time.Time) string { return t.UTC().Format("2006-01-02 15:04:05") }

func lower(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'A' && b[i] <= 'Z' {
			b[i] += 'a' - 'A'
		}
	}
	return string(b)
}
