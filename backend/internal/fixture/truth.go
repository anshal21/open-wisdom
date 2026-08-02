package fixture

// Ground truth for the committed fixture.
//
// These are the figures the provider conformance suite scores a model against:
// it asks a question in English, executes whatever SQL the model writes, and
// compares the result to the value here. So this file is the reference against
// which "did the model get it right?" is decided, and it must not be derived
// from anything the model touches.
//
// Every constant carries the SQL that produced it. Two reasons that matters:
//
//   - A reader can re-derive any of these by hand in a few seconds. A magic
//     number in a correctness suite is a claim; a number with its derivation
//     attached is a fact.
//   - The old truths were computed against a third-party dataset we could not
//     licence, which made them uncheckable in principle — the file they came
//     from could not ship. These come from data in this repository.
//
// TestGroundTruth in this package re-executes every query below against the
// built fixture and fails if any drifts. Regenerating the fixture therefore
// cannot silently invalidate the conformance suite: it breaks one test, in this
// package, with the correct value in the failure message.
const (
	// SELECT count(*) FROM order_items
	CountOrderItems = 508

	// SELECT count(*) FROM order_items WHERE year(created_at) = 2023
	CountOrderItems2023 = 134

	// SELECT count(*) FROM users
	CountUsers = 60

	// SELECT count(*) FROM products
	CountProducts = 40

	// SELECT count(*) FROM orders
	CountOrders = 200

	// SELECT count(DISTINCT category) FROM products
	DistinctProductCategories = 8

	// SELECT count(DISTINCT department) FROM products
	DistinctProductDepartments = 3

	// SELECT sum(sale_price) FROM order_items
	//
	// Gross: no status filter. The net figure differs, which is exactly the
	// ambiguity "what was our revenue?" carries and the reason the pipeline
	// refuses that question rather than picking a reading.
	TotalSalePrice = 51614.59

	// SELECT sum(sale_price) FROM order_items WHERE year(created_at) = 2023
	TotalSalePrice2023 = 12658.22

	// SELECT avg(sale_price) FROM order_items WHERE year(created_at) = 2023
	//
	// Carried to six decimals because the natural tolerance for a mean is
	// looser than for a sum, and a truth stated to fewer digits than the
	// tolerance is not a truth.
	AvgSalePrice2023 = 94.464328

	// SELECT sum(sale_price) FROM order_items
	//  WHERE status NOT IN ('Cancelled', 'Returned')
	//    AND created_at >= '2023-01-01' AND created_at < '2024-01-01'
	//
	// Net of cancellations and returns, with the literals cased as the column
	// actually stores them. Lower-casing them matches nothing and yields
	// TotalSalePrice2023 instead — a silent 17% overstatement, and the failure
	// the filter-literal check exists to catch.
	NetSalePrice2023 = 10792.58

	// SELECT count(*) FROM events
	CountEvents = 300

	// SELECT count(*) FROM events WHERE user_id IS NULL
	//
	// Anonymous sessions. `events JOIN users` drops every one of them, which is
	// what the join-loss check detects.
	CountAnonymousEvents = 75

	// SELECT sum(num_of_item) FROM orders
	TotalItemsOrdered = 508

	// SELECT sum(o.num_of_item) FROM orders o JOIN order_items oi USING (order_id)
	//
	// The same measure summed across a one-to-many join: inflated threefold.
	// The fan-out check exists to stop this number reaching a dashboard.
	TotalItemsOrderedFannedOut = 1518
)

// Tolerances for the floating-point truths.
//
// The sums are of values with two decimal places, so the only error is
// accumulated binary rounding — order 1e-11 at these magnitudes. 1e-6 is
// generous and still tight enough that a wrong query cannot slip through: the
// smallest single sale in the fixture is over a dollar.
const (
	SumTolerance = 1e-6
	AvgTolerance = 1e-4
)
