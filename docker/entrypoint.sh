#!/usr/bin/env bash
# Start the API and the web app together, and make sure that when one dies the
# container dies with it — a half-running stack that still answers on :3000 but
# has no backend is the most confusing possible failure for a first run.
set -euo pipefail

: "${ANALYST_LLM:=mock}"

# -warehouse is passed only when it names a file that is actually there.
#
# The image bakes in no data, so the default path points at a bind mount that
# may or may not have been provided. Passing a non-existent path would register
# a source that fails every query — strictly worse than no source at all, since
# the product has a coherent "connect a source" state and no coherent "your
# source is a lie" state. A missing file here is a normal first run, so it is
# announced, not treated as an error.
warehouse_args=()
if [ -n "${ANALYST_WAREHOUSE:-}" ]; then
  if [ -f "${ANALYST_WAREHOUSE}" ]; then
    warehouse_args=(-warehouse "${ANALYST_WAREHOUSE}")
  else
    echo "no warehouse at ${ANALYST_WAREHOUSE} — starting with no data source."
    echo "Add one from the UI, or mount a DuckDB file there (see docker-compose.yml)."
  fi
fi

# The API stays on loopback even inside the container. The browser never talks
# to it directly — Next's route handlers proxy /api/v1/* server-side — so there
# is no reason to expose an unauthenticated API on the container network.
analyst-server \
  -llm "${ANALYST_LLM}" \
  -db "${ANALYST_DB}" \
  "${warehouse_args[@]}" &
api=$!

# Standalone output ships its own minimal server; `next start` is not
# installed in this image by design.
cd /app/frontend
PORT=3000 HOSTNAME=0.0.0.0 node server.js &
web=$!

shutdown() { kill -TERM "$api" "$web" 2>/dev/null || true; }
trap shutdown TERM INT

# Exit as soon as either process does, with its status.
wait -n "$api" "$web"
status=$?
shutdown
exit "$status"
