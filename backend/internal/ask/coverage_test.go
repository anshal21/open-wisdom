package ask

import (
	"testing"

	"github.com/anshal21/ai-analyst/backend/internal/verify"
	"github.com/anshal21/ai-analyst/backend/internal/warehouse"
)

// A query that matched nothing must fail coverage outright — this is the
// backstop that keeps a NULL aggregate from ever wearing a verified seal.
func TestCoverageFailsOnEmptyResult(t *testing.T) {
	cases := map[string]*warehouse.Result{
		"zero rows":    {Columns: []warehouse.ResultColumn{{Name: "total"}}, Rows: [][]any{}},
		"all-null row": {Columns: []warehouse.ResultColumn{{Name: "total"}}, Rows: [][]any{{nil}}},
		"nil result":   nil,
	}
	for name, res := range cases {
		c, cov := coverageCheck(&verify.Query{}, nil, nil, res)
		if c.Status != verify.StatusFail {
			t.Errorf("%s: want fail, got %s", name, c.Status)
		}
		if cov != nil {
			t.Errorf("%s: no chart coverage should be reported for an empty result", name)
		}
	}
}

func TestCoverageNotFailedByRealSingleValue(t *testing.T) {
	res := &warehouse.Result{Columns: []warehouse.ResultColumn{{Name: "total"}}, Rows: [][]any{{float64(42)}}}
	c, _ := coverageCheck(&verify.Query{}, &warehouse.Catalog{}, nil, res)
	if c.Status == verify.StatusFail {
		t.Errorf("a real scalar must not fail coverage: %s", c.Finding)
	}
}
