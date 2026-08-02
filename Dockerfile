# Analyst — single-image build.
#
# Two stages compile, one runs. The backend needs CGO because DuckDB is a cgo
# binding with vendored native libraries, so the build stage carries a toolchain
# the runtime stage does not.

# --- frontend build --------------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./

# NEXT_PUBLIC_* is inlined into the client bundle at BUILD time, so it must be
# set here rather than in the runtime stage. `live` is deliberate: the default
# `auto` silently falls back to bundled fixtures when the backend is
# unreachable, which would show a visitor fabricated numbers and tell them
# nothing. In a container the backend is a sibling process — if it is down,
# that is a failure to surface, not to paper over.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_API_MODE=live
RUN npm run build

# --- backend build ---------------------------------------------------------
FROM golang:1.26-bookworm AS api
WORKDIR /src/backend
# DuckDB is cgo with vendored natives.
ENV CGO_ENABLED=1
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN go build -o /out/analyst-server ./cmd/server

# --- runtime ---------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# python3 is present only because notebook Python cells need an interpreter.
# The feature itself ships DISABLED — see the security note in the README.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

# Create the user BEFORE copying, so each COPY lands with the right ownership.
# `chown -R` over a copied tree rewrites every inode into a new layer — on the
# old node_modules copy that cost 80s and a layer large enough to exhaust the
# disk on export.
RUN useradd --create-home --uid 10001 analyst && mkdir -p /app/data /app/warehouse

COPY --from=api --chown=analyst:analyst /out/analyst-server /usr/local/bin/analyst-server

# Standalone output: Next traces the modules the server actually imports, so
# this is a few MB rather than the whole dependency tree. `.next/static` and
# `public` are not traced and must be copied alongside it.
COPY --from=web --chown=analyst:analyst /src/frontend/.next/standalone /app/frontend
COPY --from=web --chown=analyst:analyst /src/frontend/.next/static /app/frontend/.next/static
COPY --from=web --chown=analyst:analyst /src/frontend/public /app/frontend/public

# No data is baked into this image, deliberately.
#
# It used to carry a 6 MB slice of a third-party dataset so that first run
# needed no download. That was convenient and wrong twice over: no licence for
# the data could be established, and it made the sample the default while
# "point it at your own warehouse" — the actual product — was the thing you had
# to go and configure.
#
# /app/warehouse is an empty mount point. Bind your DuckDB file over it (see
# docker-compose.yml) or leave it empty and add a source from the UI. Starting
# with no data is a supported, coherent state, not a broken one.
RUN chown analyst:analyst /app/data /app/warehouse
# Non-root: the server executes model-generated SQL and, if explicitly enabled,
# user-supplied Python. Neither should run as uid 0.
USER analyst

# NEXT_PUBLIC_API_MODE is NOT set here — it is inlined at build time (see the
# web stage). Setting it at runtime would look like configuration and do
# nothing, which is worse than not offering it.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    BACKEND_ORIGIN=http://127.0.0.1:8080 \
    ANALYST_DB=/app/data/analyst.db

# Only the web app. The API stays on the container's loopback — it has no
# authentication, and the browser reaches it through Next's server-side proxy.
EXPOSE 3000
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
