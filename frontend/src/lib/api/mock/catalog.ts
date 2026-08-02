import type { Catalog, CatalogTable } from "@/lib/api/types";
import { days, hours } from "./base";

/**
 * Fixture support. `src_1` mirrors the e-commerce warehouse the rest of the
 * fixtures query against: 7 tables, realistic column roles, and one
 * intentional N:N relationship (order_items -> inventory_items) so the
 * schema browser's fan-out badge (screens.md §10.4) has something to show.
 */

const USERS_TABLE: CatalogTable = {
  name: "users",
  row_count: 100000,
  columns: [
    { name: "id", type: "bigint", role: "key", null_rate: 0, distinct_count: 100000 },
    { name: "first_name", type: "varchar", role: "pii", null_rate: 0, distinct_count: 4218 },
    { name: "last_name", type: "varchar", role: "pii", null_rate: 0, distinct_count: 6104 },
    { name: "email", type: "varchar", role: "pii", null_rate: 0, distinct_count: 100000 },
    { name: "age", type: "integer", role: "dimension", null_rate: 0, distinct_count: 63 },
    { name: "gender", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 2 },
    { name: "state", type: "varchar", role: "dimension", null_rate: 0.002, distinct_count: 52 },
    { name: "street_address", type: "varchar", role: "pii", null_rate: 0.001, distinct_count: 98422 },
    { name: "postal_code", type: "varchar", role: "dimension", null_rate: 0.001, distinct_count: 18904 },
    { name: "city", type: "varchar", role: "dimension", null_rate: 0.001, distinct_count: 9812 },
    { name: "country", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 11 },
    { name: "traffic_source", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 5 },
    { name: "created_at", type: "timestamp", role: "date", null_rate: 0, distinct_count: 99884 },
  ],
  relationships: [],
  sample_rows: [
    [1, "Lauren", "Barrett", "lauren.barrett@example.com", 34, "F", "California", "412 Elm St", "94110", "San Francisco", "United States", "Organic", "2021-03-04T10:12:00Z"],
    [2, "Marcus", "Nguyen", "marcus.nguyen@example.com", 41, "M", "Texas", "9 Live Oak Ave", "77002", "Houston", "United States", "Email", "2021-03-04T11:02:00Z"],
    [3, "Priya", "Chandran", "priya.chandran@example.com", 29, "F", "New York", "2201 Bedford Ave", "11225", "Brooklyn", "United States", "Facebook", "2021-03-05T02:41:00Z"],
    [4, "Diego", "Alvarez", "diego.alvarez@example.com", 52, "M", "Illinois", "77 W Adams St", "60603", "Chicago", "United States", "Organic", "2021-03-06T09:15:00Z"],
  ],
};

const ORDERS_TABLE: CatalogTable = {
  name: "orders",
  row_count: 125226,
  columns: [
    { name: "order_id", type: "bigint", role: "key", null_rate: 0, distinct_count: 125226 },
    { name: "user_id", type: "bigint", role: "key", null_rate: 0, distinct_count: 91882 },
    { name: "status", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 6 },
    { name: "gender", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 2 },
    { name: "created_at", type: "timestamp", role: "date", null_rate: 0, distinct_count: 124910 },
    { name: "returned_at", type: "timestamp", role: "date", null_rate: 0.897, distinct_count: 12884 },
    { name: "shipped_at", type: "timestamp", role: "date", null_rate: 0.084, distinct_count: 114716 },
    { name: "delivered_at", type: "timestamp", role: "date", null_rate: 0.163, distinct_count: 104802 },
    { name: "num_of_item", type: "integer", role: "measure", null_rate: 0, distinct_count: 4 },
  ],
  relationships: [{ from_column: "user_id", to_table: "users", to_column: "id", cardinality: "N:1" }],
  sample_rows: [
    [100234, 1, "Shipped", "F", "2023-02-03T08:14:00Z", null, "2023-02-05T14:02:00Z", null, 2],
    [100235, 2, "Complete", "M", "2023-02-03T09:41:00Z", null, "2023-02-04T10:00:00Z", "2023-02-07T16:30:00Z", 1],
    [100236, 3, "Cancelled", "F", "2023-02-03T10:02:00Z", null, null, null, 3],
    [100237, 4, "Returned", "M", "2023-02-04T02:18:00Z", "2023-02-12T11:00:00Z", "2023-02-05T09:00:00Z", "2023-02-08T13:00:00Z", 1],
  ],
};

const ORDER_ITEMS_TABLE: CatalogTable = {
  name: "order_items",
  row_count: 181759,
  columns: [
    { name: "id", type: "bigint", role: "key", null_rate: 0, distinct_count: 181759 },
    { name: "order_id", type: "bigint", role: "key", null_rate: 0, distinct_count: 125226 },
    { name: "user_id", type: "bigint", role: "key", null_rate: 0, distinct_count: 91882 },
    { name: "product_id", type: "bigint", role: "key", null_rate: 0, distinct_count: 29120 },
    { name: "inventory_item_id", type: "bigint", role: "key", null_rate: 0, distinct_count: 181759 },
    { name: "status", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 6 },
    { name: "sale_price", type: "decimal", role: "measure", null_rate: 0, distinct_count: 4218 },
    { name: "created_at", type: "timestamp", role: "date", null_rate: 0, distinct_count: 181490 },
    { name: "shipped_at", type: "timestamp", role: "date", null_rate: 0.084, distinct_count: 166302 },
    { name: "delivered_at", type: "timestamp", role: "date", null_rate: 0.163, distinct_count: 151884 },
    { name: "returned_at", type: "timestamp", role: "date", null_rate: 0.897, distinct_count: 18664 },
  ],
  relationships: [
    { from_column: "order_id", to_table: "orders", to_column: "order_id", cardinality: "N:1" },
    { from_column: "product_id", to_table: "products", to_column: "id", cardinality: "N:1" },
    { from_column: "inventory_item_id", to_table: "inventory_items", to_column: "id", cardinality: "N:N" },
  ],
  sample_rows: [
    [500112, 100234, 1, 8821, 500112, "Shipped", 64.0, "2023-02-03T08:14:00Z", "2023-02-05T14:02:00Z", null, null],
    [500113, 100234, 1, 4402, 500113, "Shipped", 38.0, "2023-02-03T08:14:00Z", "2023-02-05T14:02:00Z", null, null],
    [500114, 100235, 2, 1190, 500114, "Complete", 89.0, "2023-02-03T09:41:00Z", "2023-02-04T10:00:00Z", "2023-02-07T16:30:00Z", null],
    [500115, 100237, 4, 3307, 500115, "Returned", 52.0, "2023-02-04T02:18:00Z", "2023-02-05T09:00:00Z", "2023-02-08T13:00:00Z", "2023-02-12T11:00:00Z"],
  ],
};

const PRODUCTS_TABLE: CatalogTable = {
  name: "products",
  row_count: 29120,
  columns: [
    { name: "id", type: "bigint", role: "key", null_rate: 0, distinct_count: 29120 },
    { name: "cost", type: "decimal", role: "measure", null_rate: 0, distinct_count: 8811 },
    { name: "category", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 26 },
    { name: "name", type: "varchar", role: "dimension", null_rate: 0.004, distinct_count: 28662 },
    { name: "brand", type: "varchar", role: "dimension", null_rate: 0.012, distinct_count: 2757 },
    { name: "retail_price", type: "decimal", role: "measure", null_rate: 0, distinct_count: 4402 },
    { name: "department", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 2 },
    { name: "sku", type: "varchar", role: "key", null_rate: 0, distinct_count: 29120 },
    { name: "distribution_center_id", type: "bigint", role: "key", null_rate: 0, distinct_count: 10 },
  ],
  relationships: [
    { from_column: "distribution_center_id", to_table: "distribution_centers", to_column: "id", cardinality: "N:1" },
  ],
  sample_rows: [
    [8821, 31.2, "Outerwear & Coats", "Quilted Puffer Jacket", "Alpine Trail", 64.0, "Women", "AT-QP-8821", 4],
    [4402, 18.9, "Jeans", "Slim Straight Denim", "Harborline", 38.0, "Men", "HB-SD-4402", 2],
    [1190, 43.6, "Sweaters", "Merino Crewneck", "Northfield", 89.0, "Women", "NF-MC-1190", 7],
    [3307, 24.1, "Fashion Hoodies", "Fleece Pullover Hoodie", "Basecamp", 52.0, "Men", "BC-FP-3307", 1],
    [9944, 12.5, "Socks", "Ribbed Crew 3-Pack", "Northfield", 18.0, "Women", "NF-RC-9944", 4],
  ],
};

const INVENTORY_ITEMS_TABLE: CatalogTable = {
  name: "inventory_items",
  row_count: 490705,
  columns: [
    { name: "id", type: "bigint", role: "key", null_rate: 0, distinct_count: 490705 },
    { name: "product_id", type: "bigint", role: "key", null_rate: 0, distinct_count: 29120 },
    { name: "created_at", type: "timestamp", role: "date", null_rate: 0, distinct_count: 489912 },
    { name: "sold_at", type: "timestamp", role: "date", null_rate: 0.371, distinct_count: 302104 },
    { name: "cost", type: "decimal", role: "measure", null_rate: 0, distinct_count: 8811 },
    { name: "product_category", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 26 },
    { name: "product_name", type: "varchar", role: "dimension", null_rate: 0.004, distinct_count: 28662 },
    { name: "product_brand", type: "varchar", role: "dimension", null_rate: 0.012, distinct_count: 2757 },
    { name: "product_retail_price", type: "decimal", role: "measure", null_rate: 0, distinct_count: 4402 },
    { name: "product_department", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 2 },
    { name: "product_sku", type: "varchar", role: "key", null_rate: 0, distinct_count: 29120 },
    { name: "product_distribution_center_id", type: "bigint", role: "key", null_rate: 0, distinct_count: 10 },
  ],
  relationships: [
    { from_column: "product_id", to_table: "products", to_column: "id", cardinality: "N:1" },
    { from_column: "product_distribution_center_id", to_table: "distribution_centers", to_column: "id", cardinality: "N:1" },
  ],
  sample_rows: [
    [500112, 8821, "2023-01-28T04:00:00Z", "2023-02-03T08:14:00Z", 31.2, "Outerwear & Coats", "Quilted Puffer Jacket", "Alpine Trail", 64.0, "Women", "AT-QP-8821", 4],
    [500113, 4402, "2023-01-29T04:00:00Z", "2023-02-03T08:14:00Z", 18.9, "Jeans", "Slim Straight Denim", "Harborline", 38.0, "Men", "HB-SD-4402", 2],
    [500116, 8821, "2023-01-30T04:00:00Z", null, 31.2, "Outerwear & Coats", "Quilted Puffer Jacket", "Alpine Trail", 64.0, "Women", "AT-QP-8821", 4],
  ],
};

const EVENTS_TABLE: CatalogTable = {
  name: "events",
  row_count: 2431963,
  columns: [
    { name: "id", type: "bigint", role: "key", null_rate: 0, distinct_count: 2431963 },
    { name: "user_id", type: "bigint", role: "key", null_rate: 0.463, distinct_count: 65221 },
    { name: "sequence_number", type: "integer", role: "dimension", null_rate: 0, distinct_count: 214 },
    { name: "session_id", type: "varchar", role: "key", null_rate: 0, distinct_count: 812004 },
    { name: "created_at", type: "timestamp", role: "date", null_rate: 0, distinct_count: 2418822 },
    { name: "ip_address", type: "varchar", role: "pii", null_rate: 0, distinct_count: 1904221 },
    { name: "city", type: "varchar", role: "dimension", null_rate: 0.002, distinct_count: 9812 },
    { name: "state", type: "varchar", role: "dimension", null_rate: 0.002, distinct_count: 52 },
    { name: "postal_code", type: "varchar", role: "dimension", null_rate: 0.002, distinct_count: 18904 },
    { name: "browser", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 6 },
    { name: "traffic_source", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 5 },
    { name: "uri", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 41 },
    { name: "event_type", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 6 },
  ],
  relationships: [{ from_column: "user_id", to_table: "users", to_column: "id", cardinality: "N:1" }],
  sample_rows: [
    [9001221, 1, 3, "sess_a91f", "2023-02-03T08:10:00Z", "73.14.201.9", "San Francisco", "California", "94110", "Chrome", "Organic", "/product/8821", "product"],
    [9001222, null, 1, "sess_c204", "2023-02-03T08:11:00Z", "142.55.90.4", "Denver", "Colorado", "80202", "Safari", "Facebook", "/", "home"],
    [9001223, 2, 5, "sess_b310", "2023-02-03T09:41:00Z", "68.201.4.117", "Houston", "Texas", "77002", "Chrome", "Email", "/cart", "cart"],
  ],
};

const DISTRIBUTION_CENTERS_TABLE: CatalogTable = {
  name: "distribution_centers",
  row_count: 10,
  columns: [
    { name: "id", type: "bigint", role: "key", null_rate: 0, distinct_count: 10 },
    { name: "name", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 10 },
    { name: "latitude", type: "decimal", role: "dimension", null_rate: 0, distinct_count: 10 },
    { name: "longitude", type: "decimal", role: "dimension", null_rate: 0, distinct_count: 10 },
  ],
  relationships: [],
  sample_rows: [
    [1, "Memphis TN", 35.1495, -90.0490],
    [2, "Chicago IL", 41.8781, -87.6298],
    [3, "Houston TX", 29.7604, -95.3698],
    [4, "Los Angeles CA", 34.0522, -118.2437],
  ],
};

export const CATALOG_SRC_1: Catalog = {
  source_id: "src_1",
  tables: [
    USERS_TABLE,
    ORDERS_TABLE,
    ORDER_ITEMS_TABLE,
    PRODUCTS_TABLE,
    INVENTORY_ITEMS_TABLE,
    EVENTS_TABLE,
    DISTRIBUTION_CENTERS_TABLE,
  ],
  introspected_at: hours(2),
};

/* ---------------------------------------------------------------------------
   src_2 — lighter marketing replica, 4 tables
--------------------------------------------------------------------------- */

const CAMPAIGNS_TABLE: CatalogTable = {
  name: "campaigns",
  row_count: 312,
  columns: [
    { name: "id", type: "bigint", role: "key", null_rate: 0, distinct_count: 312 },
    { name: "name", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 312 },
    { name: "channel", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 6 },
    { name: "started_at", type: "timestamp", role: "date", null_rate: 0, distinct_count: 298 },
    { name: "ended_at", type: "timestamp", role: "date", null_rate: 0.18, distinct_count: 240 },
  ],
  relationships: [],
  sample_rows: [
    [1, "March promo — outerwear", "Email", "2023-03-01T00:00:00Z", "2023-03-15T00:00:00Z"],
    [2, "Spring social push", "Social", "2023-03-04T00:00:00Z", null],
  ],
};

const AD_SPEND_TABLE: CatalogTable = {
  name: "ad_spend",
  row_count: 18420,
  columns: [
    { name: "id", type: "bigint", role: "key", null_rate: 0, distinct_count: 18420 },
    { name: "campaign_id", type: "bigint", role: "key", null_rate: 0, distinct_count: 312 },
    { name: "date", type: "date", role: "date", null_rate: 0, distinct_count: 620 },
    { name: "channel", type: "varchar", role: "dimension", null_rate: 0, distinct_count: 6 },
    { name: "spend_usd", type: "decimal", role: "measure", null_rate: 0, distinct_count: 9104 },
    { name: "impressions", type: "bigint", role: "measure", null_rate: 0, distinct_count: 14022 },
  ],
  relationships: [{ from_column: "campaign_id", to_table: "campaigns", to_column: "id", cardinality: "N:1" }],
  sample_rows: [
    [90211, 1, "2023-03-01", "Email", 412.5, 18420],
    [90212, 1, "2023-03-02", "Email", 388.0, 17110],
    [90213, 2, "2023-03-04", "Social", 604.2, 41200],
  ],
};

const EMAIL_SENDS_TABLE: CatalogTable = {
  name: "email_sends",
  row_count: 641200,
  columns: [
    { name: "id", type: "bigint", role: "key", null_rate: 0, distinct_count: 641200 },
    { name: "campaign_id", type: "bigint", role: "key", null_rate: 0.02, distinct_count: 288 },
    { name: "recipient_email", type: "varchar", role: "pii", null_rate: 0, distinct_count: 84102 },
    { name: "sent_at", type: "timestamp", role: "date", null_rate: 0, distinct_count: 622104 },
    { name: "opened", type: "boolean", role: "dimension", null_rate: 0, distinct_count: 2 },
    { name: "clicked", type: "boolean", role: "dimension", null_rate: 0, distinct_count: 2 },
  ],
  relationships: [{ from_column: "campaign_id", to_table: "campaigns", to_column: "id", cardinality: "N:1" }],
  sample_rows: [
    [710044, 1, "lauren.barrett@example.com", "2023-03-01T09:00:00Z", true, true],
    [710045, 1, "marcus.nguyen@example.com", "2023-03-01T09:00:00Z", true, false],
    [710046, 1, "priya.chandran@example.com", "2023-03-01T09:00:00Z", false, false],
  ],
};

const LANDING_PAGE_VISITS_TABLE: CatalogTable = {
  name: "landing_page_visits",
  row_count: 902114,
  columns: [
    { name: "id", type: "bigint", role: "key", null_rate: 0, distinct_count: 902114 },
    { name: "campaign_id", type: "bigint", role: "key", null_rate: 0.31, distinct_count: 240 },
    { name: "visited_at", type: "timestamp", role: "date", null_rate: 0, distinct_count: 889402 },
    { name: "referrer", type: "varchar", role: "dimension", null_rate: 0.06, distinct_count: 412 },
    { name: "converted", type: "boolean", role: "dimension", null_rate: 0, distinct_count: 2 },
  ],
  relationships: [{ from_column: "campaign_id", to_table: "campaigns", to_column: "id", cardinality: "N:1" }],
  sample_rows: [
    [1200441, 1, "2023-03-01T09:04:00Z", "email", true],
    [1200442, null, "2023-03-01T09:05:00Z", "google", false],
    [1200443, 2, "2023-03-04T14:20:00Z", "facebook", false],
  ],
};

export const CATALOG_SRC_2: Catalog = {
  source_id: "src_2",
  tables: [CAMPAIGNS_TABLE, AD_SPEND_TABLE, EMAIL_SENDS_TABLE, LANDING_PAGE_VISITS_TABLE],
  introspected_at: days(9),
};

export const CATALOGS: Record<string, Catalog> = {
  src_1: CATALOG_SRC_1,
  src_2: CATALOG_SRC_2,
};
