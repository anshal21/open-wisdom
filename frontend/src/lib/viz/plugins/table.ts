import { registerMeta } from "../registry";

/**
 * The universal floor. Always legal, affinity 1 — so it wins only when every
 * chart form has declined, which is exactly the behaviour the product wants:
 * a table states the numbers and never lies about a shape it cannot carry.
 */
export const tableMeta = registerMeta({
  id: "table",
  label: "Table",
  order: 90,
  channels: [],
  legality: () => ({ ok: true }),
  affinity: () => 1,
  options: [
    {
      key: "density",
      kind: "select",
      label: "Density",
      values: [
        { value: "comfortable", label: "Comfortable" },
        { value: "compact", label: "Compact" },
      ],
      default: "comfortable",
    },
  ],
});
