package api

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

// Optional shared-token authentication.
//
// The honest default remains **no authentication**: Analyst is a single-user
// local tool, it binds to loopback, and the README says so plainly. This exists
// for the one case that default does not cover — somebody putting it behind a
// reverse proxy or on a shared machine — and it is deliberately the smallest
// thing that helps rather than an invented identity system.
//
// What it is NOT: user accounts, roles, or per-resource authorization. A holder
// of the token can do everything. Pretending otherwise by shipping a
// half-built permission model would be worse than this, because a permission
// model that is 80% right reads as 100% right to the person relying on it.
//
// `caller()` still reads X-User for attribution — who asked a question — and
// that remains untrusted, self-asserted metadata. Authentication says "you may
// use this server"; it does not say "you are who you claim".

// tokenAuth wraps a handler so every request must present the shared token.
//
// Accepted as `Authorization: Bearer <token>` or `X-Analyst-Token: <token>`.
// The second exists because the browser client already sends custom headers and
// adding a bearer scheme there is more ceremony than this earns.
func tokenAuth(token string, next http.Handler) http.Handler {
	if token == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// CORS preflight carries no custom headers by definition, so requiring
		// the token here would break every browser client before it ever got
		// to send one.
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		if !authorized(r, token) {
			writeError(w, http.StatusUnauthorized, "unauthorized",
				"This server requires an access token. Send it as `Authorization: Bearer <token>` or `X-Analyst-Token: <token>`.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func authorized(r *http.Request, token string) bool {
	if got := strings.TrimSpace(r.Header.Get("X-Analyst-Token")); got != "" {
		return constantTimeEqual(got, token)
	}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	const prefix = "Bearer "
	if len(auth) > len(prefix) && strings.EqualFold(auth[:len(prefix)], prefix) {
		return constantTimeEqual(strings.TrimSpace(auth[len(prefix):]), token)
	}
	return false
}

// constantTimeEqual avoids leaking the token's contents through response
// timing. Comparing lengths first would leak the length, so both operands are
// hashed to a fixed width by subtle's own contract of comparing equal-length
// slices — here achieved by only comparing when lengths match, which leaks
// only the length. That is an accepted trade for a shared secret the operator
// chose; a per-user credential would deserve better.
func constantTimeEqual(got, want string) bool {
	if len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}
