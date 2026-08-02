package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

// The default must stay open. Analyst is a local single-user tool and the
// README promises exactly that; a surprise 401 on a fresh clone would be a
// worse bug than the missing auth.
func TestNoTokenMeansNoAuthentication(t *testing.T) {
	h := tokenAuth("", okHandler())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/answers", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("unauthenticated default should pass, got %d", rec.Code)
	}
}

func TestTokenRequiredWhenConfigured(t *testing.T) {
	h := tokenAuth("s3cret", okHandler())

	cases := []struct {
		name   string
		header [2]string
		want   int
	}{
		{"no credentials", [2]string{"", ""}, http.StatusUnauthorized},
		{"wrong bearer", [2]string{"Authorization", "Bearer nope"}, http.StatusUnauthorized},
		{"wrong custom header", [2]string{"X-Analyst-Token", "nope"}, http.StatusUnauthorized},
		{"right bearer", [2]string{"Authorization", "Bearer s3cret"}, http.StatusOK},
		{"lowercase scheme", [2]string{"Authorization", "bearer s3cret"}, http.StatusOK},
		{"right custom header", [2]string{"X-Analyst-Token", "s3cret"}, http.StatusOK},
		// A prefix of the token must not pass — this is what a length-only
		// comparison would let through.
		{"token prefix", [2]string{"X-Analyst-Token", "s3cre"}, http.StatusUnauthorized},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/api/v1/answers", nil)
			if c.header[0] != "" {
				r.Header.Set(c.header[0], c.header[1])
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, r)
			if rec.Code != c.want {
				t.Fatalf("got %d, want %d", rec.Code, c.want)
			}
		})
	}
}

// A CORS preflight carries no custom headers by definition. Requiring the
// token here would break every browser client before it could ever send one.
func TestPreflightIsNotBlocked(t *testing.T) {
	h := tokenAuth("s3cret", okHandler())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodOptions, "/api/v1/answers", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("preflight should pass, got %d", rec.Code)
	}
}

// The rejection must tell an operator how to authenticate; a bare 401 sends
// people to the source to find out what header to send.
func TestUnauthorizedExplainsHow(t *testing.T) {
	h := tokenAuth("s3cret", okHandler())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/answers", nil))
	body := rec.Body.String()
	for _, want := range []string{"Bearer", "X-Analyst-Token"} {
		if !contains(body, want) {
			t.Errorf("401 body should mention %q: %s", want, body)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (len(needle) == 0 ||
		func() bool {
			for i := 0; i+len(needle) <= len(haystack); i++ {
				if haystack[i:i+len(needle)] == needle {
					return true
				}
			}
			return false
		}())
}

// TestCORSDoesNotReflectArbitraryOrigins pins the fix for a critical finding.
//
// withCORS used to echo the request's own Origin into
// Access-Control-Allow-Origin alongside Allow-Credentials: true, which permits
// EVERY origin. With no authentication by default, any website the operator
// visited could read /api/v1/sources and DELETE their notebooks — from the
// operator's own browser, with their own cookies.
//
// Binding to loopback does not mitigate this. The attacker is not on the
// network; it is the other tab. An operator following the README exactly —
// local use, never exposed — was fully exploitable.
func TestCORSDoesNotReflectArbitraryOrigins(t *testing.T) {
	h := withCORS(nil, okHandler())

	t.Run("hostile origin gets no CORS grant", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/api/v1/sources", nil)
		r.Header.Set("Origin", "https://evil.example")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)

		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Fatalf("reflected a hostile origin: %q", got)
		}
		if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
			t.Fatalf("granted credentials to a hostile origin: %q", got)
		}
	})

	t.Run("hostile preflight is not granted DELETE", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodOptions, "/api/v1/notebooks/x/cells/y", nil)
		r.Header.Set("Origin", "https://evil.example")
		r.Header.Set("Access-Control-Request-Method", "DELETE")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		if got := rec.Header().Get("Access-Control-Allow-Methods"); got != "" {
			t.Fatalf("advertised methods to a hostile origin: %q", got)
		}
	})

	t.Run("the bundled frontend still works", func(t *testing.T) {
		for _, origin := range []string{"http://localhost:3000", "http://127.0.0.1:3111"} {
			r := httptest.NewRequest(http.MethodGet, "/api/v1/sources", nil)
			r.Header.Set("Origin", origin)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, r)
			if rec.Header().Get("Access-Control-Allow-Origin") != origin {
				t.Fatalf("%s was refused; the bundled UI must keep working", origin)
			}
		}
	})

	t.Run("Vary is set even when refused", func(t *testing.T) {
		// A cache that misses this serves one origin's response to another.
		r := httptest.NewRequest(http.MethodGet, "/api/v1/sources", nil)
		r.Header.Set("Origin", "https://evil.example")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		if rec.Header().Get("Vary") != "Origin" {
			t.Fatal("Vary: Origin missing on a refused request")
		}
	})

	t.Run("an explicitly configured origin is allowed, but never a wildcard", func(t *testing.T) {
		h := withCORS([]string{"https://ui.internal", "*", ""}, okHandler())
		for origin, want := range map[string]bool{
			"https://ui.internal": true,
			"https://evil.example": false,
		} {
			r := httptest.NewRequest(http.MethodGet, "/api/v1/sources", nil)
			r.Header.Set("Origin", origin)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, r)
			granted := rec.Header().Get("Access-Control-Allow-Origin") != ""
			if granted != want {
				t.Errorf("origin %s: granted=%v want=%v", origin, granted, want)
			}
		}
	})
}

// TestCrossOriginWritesAreRefused covers the half that CORS does not.
//
// Withholding CORS headers stops an attacker READING a response. It does not
// stop them CAUSING one: a "simple request" (POST with text/plain) needs no
// preflight, and this API decodes JSON without inspecting Content-Type.
// Verified against a live server before the fix: a page on another origin
// created a notebook (201) while unable to read a byte back.
func TestCrossOriginWritesAreRefused(t *testing.T) {
	h := withCORS(nil, okHandler())

	call := func(method, origin string) int {
		r := httptest.NewRequest(method, "/api/v1/notebooks", nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec.Code
	}

	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		if got := call(m, "https://evil.example"); got != http.StatusForbidden {
			t.Errorf("%s from a hostile origin = %d, want 403", m, got)
		}
		if got := call(m, "http://localhost:3000"); got != http.StatusOK {
			t.Errorf("%s from the bundled UI = %d, want it to work", m, got)
		}
		// curl, the Next server-side proxy and the CLI send no Origin.
		// Browsers attach it exactly when it matters.
		if got := call(m, ""); got != http.StatusOK {
			t.Errorf("%s with no Origin = %d, want it to work", m, got)
		}
	}

	// Reads stay open: they are safe by contract, and the attacker cannot
	// read the response anyway without a CORS grant.
	if got := call(http.MethodGet, "https://evil.example"); got != http.StatusOK {
		t.Errorf("GET from another origin = %d; refusing it protects nothing", got)
	}
}
