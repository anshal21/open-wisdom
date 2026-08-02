#!/usr/bin/env bash
#
# Build the optional sample warehouse.
#
#   ./scripts/setup-sample-data.sh
#
# You do not need this. Analyst is meant to be pointed at your own data — see
# "Connect your data" in the README. This exists for the case where you want
# something to click around in before you trust it with anything real.
#
# Everything it produces is generated on your machine from a seeded generator in
# this repository (backend/internal/fixture/gen). Nothing is downloaded, nothing
# is fetched from a third party, and the data is invented — a fictional clothing
# retailer with three years of orders. It is licensed with this repository under
# Apache-2.0, like the rest of the source.
#
# That last point is not incidental. The previous sample was a slice of a
# third-party public dataset reached through a mirror, and no licence for it
# could be established. Shipping data you have no stated right to redistribute
# is exactly what a corporate licence scan flags, so it was replaced rather than
# re-hosted.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$repo_root/sample/analyst-sample.duckdb}"
scale="${ANALYST_SAMPLE_SCALE:-demo}"

if ! command -v go >/dev/null 2>&1; then
  cat >&2 <<'EOF'
error: this script builds the sample warehouse with Go, and `go` is not on your PATH.

Install Go 1.25 or newer (https://go.dev/dl/) and run this again. If you would
rather not install Go, `docker compose up` builds and runs everything in a
container instead — see the README.
EOF
  exit 1
fi

# Idempotent: an existing file is replaced, not appended to. Rebuilding is
# cheap and always produces the same bytes, so there is no reason to make the
# caller reason about staleness.
if [ -e "$out" ]; then
  echo "replacing existing $out"
fi

mkdir -p "$(dirname "$out")"

echo "generating the $scale-scale sample warehouse (this takes a few seconds)..."
( cd "$repo_root/backend" && go run ./cmd/gensample -scale "$scale" -duckdb "$out" )

cat <<EOF

Done. Point Analyst at it:

  cd backend && go run ./cmd/server -llm mock -warehouse "$out"

or, in Docker:

  ANALYST_DATA="$out" docker compose up

What is in it: a fictional clothing retailer — users, products, orders,
order_items, inventory_items, events and distribution_centers — covering
2023-01-01 through 2025-12-31. No real people, no real company, no real sales.
Email addresses use example.com, which RFC 2606 reserves so that generated
addresses cannot reach a mailbox.

It is deliberately imperfect in three ways, because a sample warehouse where
nothing can go wrong teaches you nothing about a product whose job is catching
things going wrong:

  · statuses are capitalised ('Cancelled'), so a query that guesses the casing
    silently overstates revenue
  · one event in five has no user, so joining events to users quietly drops rows
  · orders have multiple line items, so summing an order-level column across the
    join inflates it

Ask "what was our revenue in 2023?" and watch it refuse: gross and net differ by
about 18% here, and the question does not say which you meant.
EOF
