package ask

import (
	"testing"

	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// The presenter names the measure rather than the query's alias in roughly two
// thirds of real answers (measured by the provider conformance suite). The hint
// used to be discarded whole, losing a correct suggestion about chart SHAPE
// over a naming quibble.
func TestPickColumnRecoversAliasNearMiss(t *testing.T) {
	res := &warehouse.Result{Columns: []warehouse.ResultColumn{
		{Name: "month", Type: "DATE"},
		{Name: "total_sale_price", Type: "DOUBLE"},
	}}

	got, ok := pickColumn(res, "sale_price")
	if !ok || got.Name != "total_sale_price" {
		t.Fatalf("near-miss not recovered: got %q ok=%v", got.Name, ok)
	}

	if got, ok := pickColumn(res, "month"); !ok || got.Name != "month" {
		t.Fatalf("exact match broken: got %q ok=%v", got.Name, ok)
	}
}

// Guessing between two candidates is how a chart starts plotting the wrong
// column, which is worse than no hint at all.
func TestPickColumnRefusesAmbiguousNearMiss(t *testing.T) {
	res := &warehouse.Result{Columns: []warehouse.ResultColumn{
		{Name: "total_sale_price", Type: "DOUBLE"},
		{Name: "avg_sale_price", Type: "DOUBLE"},
	}}
	if _, ok := pickColumn(res, "sale_price"); ok {
		t.Fatal("ambiguous near-miss should be refused, not guessed")
	}
}

// Token boundaries: `price_id` must not satisfy a hint of `price`.
func TestPickColumnRespectsTokenBoundaries(t *testing.T) {
	res := &warehouse.Result{Columns: []warehouse.ResultColumn{
		{Name: "priceless_widgets", Type: "BIGINT"},
	}}
	if _, ok := pickColumn(res, "price"); ok {
		t.Fatal("substring inside a word should not match")
	}
}

func TestPickColumnUnknownStillFails(t *testing.T) {
	res := &warehouse.Result{Columns: []warehouse.ResultColumn{
		{Name: "month", Type: "DATE"},
	}}
	if _, ok := pickColumn(res, "revenue"); ok {
		t.Fatal("a genuinely absent column must not resolve")
	}
}
