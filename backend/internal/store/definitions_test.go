package store

import "testing"

// One word ratified to mean two things is contested on both sides; a lone
// ratified name stays verified. Proposed rows never count toward a collision.
func TestMarkContested(t *testing.T) {
	defs := []Definition{
		{Name: "Revenue", Status: DefRatified, Confidence: "verified"},
		{Name: "revenue", Status: DefRatified, Confidence: "verified"},
		{Name: "Customers", Status: DefRatified, Confidence: "verified"},
		{Name: "Customers", Status: DefProposed, Confidence: "unverified"},
	}
	markContested(defs)
	if defs[0].Confidence != "contested" || defs[1].Confidence != "contested" {
		t.Errorf("colliding ratified names must both be contested: %s / %s", defs[0].Confidence, defs[1].Confidence)
	}
	if defs[2].Confidence != "verified" {
		t.Errorf("a ratified name colliding only with a proposal stays verified, got %s", defs[2].Confidence)
	}
	if defs[3].Confidence != "unverified" {
		t.Errorf("proposals are never contested, got %s", defs[3].Confidence)
	}
}
