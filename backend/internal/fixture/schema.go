package fixture

// schema is the fixture warehouse's DDL.
//
// Types are declared rather than inferred. DuckDB's CSV sniffer is good, but it
// is not a contract: it would happily widen a column, and a fixture whose
// column types depend on which rows happen to be present is not a fixture. It
// also decides what an empty field means, and three columns here rely on empty
// meaning NULL (see below).
//
// Timestamps are TIMESTAMP, not TIMESTAMPTZ. The values carry no offset, so
// storing them as instants would make them depend on the loading session's zone
// — and DATE_TRUNC over TIMESTAMPTZ buckets in the session zone, which is how a
// host in IST puts "January" at Dec 31 18:30 UTC. A wall-clock type has no zone
// to get wrong.
//
// Three deliberate nullability choices, each of which a check depends on:
//
//   - events.user_id is NULL for anonymous sessions, so `events JOIN users`
//     drops rows. That is the join-loss check's whole subject.
//   - orders/order_items shipped_at, delivered_at and returned_at are NULL
//     according to status, so a Cancelled row has no delivery date. Averaging
//     over a nullable column with a filter that assumes it is present is a real
//     bug, and it needs real NULLs to be catchable.
//   - nothing else is nullable, so a NULL anywhere else is a load error rather
//     than data.
const schema = `
CREATE TABLE distribution_centers (
  id                     INTEGER   NOT NULL,
  name                   VARCHAR   NOT NULL,
  city                   VARCHAR   NOT NULL,
  country                VARCHAR   NOT NULL
);

CREATE TABLE products (
  id                     INTEGER   NOT NULL,
  name                   VARCHAR   NOT NULL,
  brand                  VARCHAR   NOT NULL,
  category               VARCHAR   NOT NULL,
  department             VARCHAR   NOT NULL,
  cost                   DOUBLE    NOT NULL,
  retail_price           DOUBLE    NOT NULL,
  distribution_center_id INTEGER   NOT NULL
);

CREATE TABLE users (
  id                     INTEGER   NOT NULL,
  first_name             VARCHAR   NOT NULL,
  last_name              VARCHAR   NOT NULL,
  email                  VARCHAR   NOT NULL,
  age                    INTEGER   NOT NULL,
  country                VARCHAR   NOT NULL,
  city                   VARCHAR   NOT NULL,
  traffic_source         VARCHAR   NOT NULL,
  created_at             TIMESTAMP NOT NULL
);

CREATE TABLE orders (
  order_id               INTEGER   NOT NULL,
  user_id                INTEGER   NOT NULL,
  status                 VARCHAR   NOT NULL,
  created_at             TIMESTAMP NOT NULL,
  shipped_at             TIMESTAMP,
  delivered_at           TIMESTAMP,
  returned_at            TIMESTAMP,
  num_of_item            INTEGER   NOT NULL
);

CREATE TABLE order_items (
  id                     INTEGER   NOT NULL,
  order_id               INTEGER   NOT NULL,
  user_id                INTEGER   NOT NULL,
  product_id             INTEGER   NOT NULL,
  inventory_item_id      INTEGER   NOT NULL,
  status                 VARCHAR   NOT NULL,
  created_at             TIMESTAMP NOT NULL,
  shipped_at             TIMESTAMP,
  delivered_at           TIMESTAMP,
  returned_at            TIMESTAMP,
  sale_price             DOUBLE    NOT NULL
);

CREATE TABLE inventory_items (
  id                     INTEGER   NOT NULL,
  product_id             INTEGER   NOT NULL,
  created_at             TIMESTAMP NOT NULL,
  sold_at                TIMESTAMP,
  cost                   DOUBLE    NOT NULL,
  product_category       VARCHAR   NOT NULL,
  product_department     VARCHAR   NOT NULL,
  product_distribution_center_id INTEGER NOT NULL
);

CREATE TABLE events (
  id                     INTEGER   NOT NULL,
  user_id                INTEGER,
  session_id             VARCHAR   NOT NULL,
  sequence_number        INTEGER   NOT NULL,
  created_at             TIMESTAMP NOT NULL,
  browser                VARCHAR   NOT NULL,
  traffic_source         VARCHAR   NOT NULL,
  event_type             VARCHAR   NOT NULL,
  country                VARCHAR   NOT NULL
);
`

// tables lists the load order. Nothing here declares foreign keys — DuckDB
// would enforce them and the fixture has no orphans to enforce against — but
// the order is kept parent-first so that adding constraints later is a one-line
// change rather than a reshuffle.
var tables = []string{
	"distribution_centers",
	"products",
	"users",
	"orders",
	"order_items",
	"inventory_items",
	"events",
}
