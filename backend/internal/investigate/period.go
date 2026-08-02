package investigate

import (
	"fmt"
	"strings"
	"time"
)

// period is a half-open date range. Half-open is not a detail: a closed range
// double-counts its boundary day when two periods are placed end to end, and
// that error looks exactly like a real movement.
type period struct {
	Label string
	From  time.Time
	To    time.Time // exclusive
}

func (p period) Days() float64 { return p.To.Sub(p.From).Hours() / 24 }

func (p period) sqlFrom() string { return p.From.Format("2006-01-02") }
func (p period) sqlTo() string   { return p.To.Format("2006-01-02") }

// parsePeriod accepts a year, a month, or an explicit range. Anything else is
// rejected rather than guessed, because silently investigating a different
// period than the one asked about is the worst possible failure here.
func parsePeriod(s string) (period, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return period{}, fmt.Errorf("no period given")
	}
	if from, to, ok := splitRange(s); ok {
		f, err := time.Parse("2006-01-02", from)
		if err != nil {
			return period{}, fmt.Errorf("parse range start %q: %w", from, err)
		}
		t, err := time.Parse("2006-01-02", to)
		if err != nil {
			return period{}, fmt.Errorf("parse range end %q: %w", to, err)
		}
		// An explicit range names its last day, so the exclusive bound is the
		// day after.
		return period{Label: s, From: f, To: t.AddDate(0, 0, 1)}, nil
	}
	if t, err := time.Parse("2006-01", s); err == nil {
		return period{Label: s, From: t, To: t.AddDate(0, 1, 0)}, nil
	}
	if t, err := time.Parse("2006", s); err == nil {
		return period{Label: s, From: t, To: t.AddDate(1, 0, 0)}, nil
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return period{Label: s, From: t, To: t.AddDate(0, 0, 1)}, nil
	}
	return period{}, fmt.Errorf("period %q is not a year, a month, a date, or a from..to range", s)
}

func splitRange(s string) (string, string, bool) {
	for _, sep := range []string{"..", " to ", "/"} {
		if i := strings.Index(s, sep); i > 0 {
			return strings.TrimSpace(s[:i]), strings.TrimSpace(s[i+len(sep):]), true
		}
	}
	return "", "", false
}

// priorPeriod is the comparison period when the caller did not name one: the
// immediately preceding period of the same kind.
func priorPeriod(p period) period {
	switch {
	case p.From.Day() == 1 && p.To == p.From.AddDate(1, 0, 0):
		f := p.From.AddDate(-1, 0, 0)
		return period{Label: f.Format("2006"), From: f, To: p.From}
	case p.From.Day() == 1 && p.To == p.From.AddDate(0, 1, 0):
		f := p.From.AddDate(0, -1, 0)
		return period{Label: f.Format("2006-01"), From: f, To: p.From}
	default:
		d := p.To.Sub(p.From)
		f := p.From.Add(-d)
		return period{
			Label: f.Format("2006-01-02") + ".." + p.From.AddDate(0, 0, -1).Format("2006-01-02"),
			From:  f, To: p.From,
		}
	}
}
