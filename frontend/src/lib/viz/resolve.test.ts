import { describe, expect, it } from "vitest";
import { isLegal, resolve, SERIES_CAP } from "./resolve";
import { getMeta } from "./registry";
import { pivot, stack, stackMax } from "./series";
import { explain } from "./explain";
import type { ResultColumn } from "@/lib/api/types";
import { effectiveHint } from "@/lib/format";

const col = (name: string, type: ResultColumn["type"]): ResultColumn => ({
  name,
  label: name,
  type,
});

const T = {
  scalar: { columns: [col("total", "quantitative")], rows: [[42]] },
  monthly: {
    columns: [col("month", "temporal"), col("revenue", "quantitative")],
    rows: [
      ["2023-01-01T00:00:00Z", 10],
      ["2023-02-01T00:00:00Z", 12],
    ],
  },
  // The reported failure: product × month × revenue.
  trendPerItem: {
    columns: [
      col("product_name", "nominal"),
      col("month", "temporal"),
      col("revenue", "quantitative"),
    ],
    rows: [
      ["Shorts", "2023-01-01T00:00:00Z", 5],
      ["Shorts", "2023-02-01T00:00:00Z", 7],
      ["Jeans", "2023-01-01T00:00:00Z", 9],
      ["Jeans", "2023-02-01T00:00:00Z", 4],
    ],
  },
  categories: {
    columns: [col("category", "nominal"), col("revenue", "quantitative")],
    rows: [
      ["A", 1],
      ["B", 2],
    ],
  },
};

describe("resolve — shape defaults", () => {
  it("1x1 numeric is a scalar", () => {
    expect(resolve(T.scalar).type).toBe("scalar");
  });

  it("temporal + measure is a line", () => {
    const s = resolve(T.monthly);
    expect(s.type).toBe("line");
    expect(s.xIdx).toBe(0);
    expect(s.yIdxs).toEqual([1]);
  });

  it("temporal + nominal + measure defaults the nominal to series — the trend-per-item case", () => {
    const s = resolve(T.trendPerItem);
    expect(s.type).toBe("line");
    expect(s.xIdx).toBe(1);
    expect(s.seriesIdx).toBe(0);
    expect(s.why.series).toBe("default");
  });

  it("nominal + measure is a bar", () => {
    expect(resolve(T.categories).type).toBe("bar");
  });
});

describe("resolve — precedence", () => {
  it("user type beats hint and default", () => {
    const s = resolve(
      T.trendPerItem,
      { type: "area", x: { field: "month", label: "", type: "temporal" }, y: [], series: null, coverage: null as never, confidence: "verified" },
      { type: "bar" },
    );
    expect(s.type).toBe("bar");
    expect(s.why.type).toBe("user");
  });

  it("hint fills what the user left open", () => {
    const s = resolve(T.trendPerItem, {
      type: "area",
      x: { field: "month", label: "", type: "temporal" },
      y: [{ field: "revenue", label: "", type: "quantitative" }],
      series: { field: "product_name", label: "", type: "nominal" } as never,
      coverage: null as never,
      confidence: "verified",
    });
    expect(s.type).toBe("area");
    expect(s.why.type).toBe("suggested");
    expect(s.why.series).toBe("suggested");
  });

  it("user can explicitly remove the series", () => {
    const s = resolve(T.trendPerItem, null, { series: null });
    expect(s.seriesIdx).toBe(-1);
    expect(s.why.series).toBe("user");
  });

  it("an impossible pick degrades visibly, never silently", () => {
    const s = resolve(T.categories, null, { type: "scalar" });
    expect(s.type).toBe("bar");
    // The note is now in the FORM's own words — its label and the reason it
    // gave — rather than a sentence the resolver synthesised about an id.
    expect(s.degraded).toContain("Number");
    expect(s.degraded).toContain("single row");
  });

  it("a hint naming a column that does not exist is discarded", () => {
    const s = resolve(T.monthly, {
      type: "line",
      x: { field: "ghost", label: "", type: "temporal" },
      y: [],
      series: null,
      coverage: null as never,
      confidence: "verified",
    });
    expect(s.xIdx).toBe(0); // fell back to the real temporal column
    expect(s.why.x).toBe("default");
  });
});

describe("pivot — series and the cap", () => {
  it("splits by series with aligned x buckets and null gaps", () => {
    const spec = resolve(T.trendPerItem);
    const p = pivot(T.trendPerItem, spec);
    expect(p.xLabels).toEqual(["2023-01-01T00:00:00Z", "2023-02-01T00:00:00Z"]);
    expect(p.series.map((s) => s.key).sort()).toEqual(["Jeans", "Shorts"]);
    expect(p.folded).toBe(0);
  });

  it("folds beyond the cap into Other and reports the fold", () => {
    const rows: (string | number)[][] = [];
    for (let i = 0; i < 20; i++) rows.push([`p${i}`, "2023-01-01T00:00:00Z", 20 - i]);
    const table = { columns: T.trendPerItem.columns, rows };
    const p = pivot(table, resolve(table));
    // The full 8 REAL series are kept — Other is a gray residual on top of
    // the cap, not a series consuming a hue slot (cap honesty, B12).
    expect(p.series).toHaveLength(SERIES_CAP + 1);
    expect(p.series.at(-1)!.isOther).toBe(true);
    expect(p.folded).toBe(20 - SERIES_CAP);
    expect(p.seriesTotal).toBe(20);
    // Other's total equals the sum of what was folded — nothing dropped.
    const foldedSum = rows.slice(SERIES_CAP).reduce((a, r) => a + (r[2] as number), 0);
    expect(p.series.at(-1)!.total).toBe(foldedSum);
  });

  it("keeps the query's x order — the author's ORDER BY is intent", () => {
    const table = {
      columns: T.categories.columns,
      rows: [
        ["Z", 1],
        ["A", 2],
      ] as (string | number)[][],
    };
    const p = pivot(table, resolve(table));
    expect(p.xLabels).toEqual(["Z", "A"]);
  });

  it("multiple measures become the series when no series column exists", () => {
    const table = {
      columns: [
        col("month", "temporal"),
        col("revenue", "quantitative"),
        col("cost", "quantitative"),
      ],
      rows: [["2023-01-01T00:00:00Z", 10, 6]] as (string | number)[][],
    };
    const spec = resolve(table);
    expect(spec.seriesIdx).toBe(-1);
    const p = pivot(table, spec);
    expect(p.series.map((s) => s.key)).toEqual(["revenue", "cost"]);
  });
});

describe("chart refusal — a legal form can still be dishonest", () => {
  const dominant = {
    columns: [col("category", "nominal"), col("revenue", "quantitative")],
    rows: [
      ["A", 9500],
      ["B", 200],
      ["C", 300],
    ] as (string | number)[][],
  };
  const spanned = {
    columns: [col("category", "nominal"), col("revenue", "quantitative")],
    rows: [
      ["A", 2_400_000],
      ["B", 900],
      ["C", 400],
    ] as (string | number)[][],
  };

  it("degrades a suggested pie with a >90% slice to the table, with the reason", () => {
    const spec = resolve(dominant, {
      type: "pie",
      x: { field: "category" },
      y: [{ field: "revenue" }],
      series: null,
      coverage: { included_rows: 3, excluded_rows: 0, reason: "" },
    } as never);
    expect(spec.type).toBe("table");
    expect(spec.degraded).toMatch(/95% of the whole/);
  });

  it("degrades a default bar spanning >1000x to the table, with the reason", () => {
    const spec = resolve(spanned);
    expect(spec.type).toBe("table");
    expect(spec.degraded).toMatch(/span/);
  });

  it("honors an explicit USER pick even when dishonest — the user outranks the guard", () => {
    const spec = resolve(dominant, null, { type: "pie" });
    expect(spec.type).toBe("pie");
    expect(spec.degraded).toBeUndefined();
  });
});

describe("registry — affinity picks the default, one row per form", () => {
  it("temporal x volunteers the line", () => {
    const s = resolve(T.monthly);
    expect(s.type).toBe("line");
    expect(s.why.type).toBe("default");
  });

  it("the table is the floor when no form fits", () => {
    // Two free-text columns: nothing to measure, so every chart declines.
    const shapeless = {
      columns: [col("id", "nominal"), col("name", "nominal")],
      rows: [
        ["a", "Anna"],
        ["b", "Ben"],
      ] as (string | number)[][],
    };
    expect(resolve(shapeless).type).toBe("table");
  });

  it("pie is never volunteered, only honoured", () => {
    const s = resolve(T.categories);
    expect(s.type).toBe("bar");
    expect(resolve(T.categories, null, { type: "pie" }).type).toBe("pie");
  });

  it("every form declares its options with complete defaults", () => {
    const s = resolve(T.categories);
    expect(s.options.orientation).toBe("auto");
    expect(s.options.stacking).toBe("none");
    expect(s.why.options.orientation).toBe("default");
  });

  it("a user option beats the default and records the voice", () => {
    const s = resolve(T.categories, null, { options: { stacking: "stacked" } });
    expect(s.options.stacking).toBe("stacked");
    expect(s.why.options.stacking).toBe("user");
  });

  it("an option outside the schema's vocabulary is dropped, not rendered", () => {
    const hint = { type: "bar", options: { stacking: "pyramid" } } as never;
    const s = resolve(T.categories, hint);
    expect(s.options.stacking).toBe("none");
    expect(s.why.options.stacking).toBe("default");
  });
});

describe("bignum — the registry's proof", () => {
  const trend = {
    columns: [col("month", "temporal"), col("revenue", "quantitative")],
    rows: [
      ["2023-01-01T00:00:00Z", 10],
      ["2023-02-01T00:00:00Z", 14],
    ] as (string | number)[][],
  };

  it("is registered and legal for a period plus a measure", () => {
    expect(getMeta("bignum")).toBeDefined();
    const s = resolve(trend);
    expect(isLegal("bignum", trend, s.xIdx, s.yIdxs)).toBe(true);
  });

  it("is never volunteered — a line shows the whole shape", () => {
    expect(resolve(trend).type).toBe("line");
  });

  it("is honoured when picked, with its own options", () => {
    const s = resolve(trend, null, { type: "bignum" });
    expect(s.type).toBe("bignum");
    expect(s.options.sparkline).toBe(true);
    expect(s.options.compareTo).toBe("first");
  });

  it("declines a nominal x, in its own words", () => {
    const s = resolve(T.categories, null, { type: "bignum" });
    expect(s.type).toBe("bar");
    expect(s.degraded).toContain("ordered period");
  });
});

describe("temporal buckets are chronological — row order is not intent", () => {
  it("sorts out-of-order dates and exposes the epochs", () => {
    const jumbled = {
      columns: [col("month", "temporal"), col("revenue", "quantitative")],
      rows: [
        ["2023-03-01T00:00:00Z", 3],
        ["2023-01-01T00:00:00Z", 1],
        ["2023-02-01T00:00:00Z", 2],
      ] as (string | number)[][],
    };
    const p = pivot(jumbled, resolve(jumbled));
    expect(p.xLabels).toEqual([
      "2023-01-01T00:00:00Z",
      "2023-02-01T00:00:00Z",
      "2023-03-01T00:00:00Z",
    ]);
    // Values travel with their bucket, not their row position.
    expect(p.series[0].points.map((pt) => pt.value)).toEqual([1, 2, 3]);
    expect(p.xEpochs).toHaveLength(3);
    expect(p.xEpochs![0]).toBeLessThan(p.xEpochs![1]);
  });

  it("leaves a nominal axis in the query's order", () => {
    const table = {
      columns: T.categories.columns,
      rows: [
        ["Z", 1],
        ["A", 2],
      ] as (string | number)[][],
    };
    expect(pivot(table, resolve(table)).xLabels).toEqual(["Z", "A"]);
    expect(pivot(table, resolve(table)).xEpochs).toBeUndefined();
  });
});

describe("stacking math", () => {
  const series = [
    { key: "a", label: "A", total: 3, points: [{ x: "1", value: 1 }, { x: "2", value: 2 }] },
    { key: "b", label: "B", total: 7, points: [{ x: "1", value: 3 }, { x: "2", value: null }] },
  ];

  it("stacks bottom-up, each band starting where the last ended", () => {
    const bands = stack(series, 2, "stacked");
    expect(bands[0][0]).toEqual({ y0: 0, y1: 1 });
    expect(bands[1][0]).toEqual({ y0: 1, y1: 4 });
  });

  it("a null contributes nothing and does not break the stack", () => {
    const bands = stack(series, 2, "stacked");
    expect(bands[0][1]).toEqual({ y0: 0, y1: 2 });
    expect(bands[1][1]).toEqual({ y0: 2, y1: 2 });
  });

  it("100% normalises each bucket to its own whole", () => {
    const bands = stack(series, 2, "100%");
    expect(bands[0][0].y1).toBeCloseTo(25);
    expect(bands[1][0].y1).toBeCloseTo(100);
    // The second bucket has one series present — it alone is the whole.
    expect(bands[0][1].y1).toBeCloseTo(100);
  });

  it("stackMax is the tallest bucket total", () => {
    expect(stackMax(stack(series, 2, "stacked"))).toBe(4);
  });
});

describe("explain — a chart explains its shape", () => {
  it("names the form and the reason for it", () => {
    const s = resolve(T.monthly);
    expect(explain(T.monthly, s)).toContain("Line, because month is a date.");
  });

  it("credits the user when the user chose", () => {
    const s = resolve(T.categories, null, { type: "pie" });
    expect(explain(T.categories, s)).toContain("because you chose it");
  });

  it("says why a column became the series", () => {
    const s = resolve(T.trendPerItem);
    expect(explain(T.trendPerItem, s)).toContain("only unclaimed dimension");
  });

  it("states what the cap did", () => {
    const rows: (string | number)[][] = [];
    for (let i = 0; i < 20; i++) rows.push([`p${i}`, "2023-01-01T00:00:00Z", 20 - i]);
    const table = { columns: T.trendPerItem.columns, rows };
    const spec = resolve(table);
    const sentence = explain(table, spec, pivot(table, spec));
    expect(sentence).toContain("top 8 of 20");
    expect(sentence).toContain("grouped as Other");
  });
});

describe("effectiveHint — the answer-level hint is not a column-level fact", () => {
  it("drops percent when the values cannot be percentages", () => {
    // A share question sliced by raw revenue: the axis must not read 2000000%.
    expect(effectiveHint("percent", [2_297_175, 1_524_648])).toBe("number");
  });

  it("keeps percent when they plausibly are", () => {
    expect(effectiveHint("percent", [53.2, 46.8])).toBe("percent");
  });

  it("allows headroom above 100 for growth against a smaller base", () => {
    expect(effectiveHint("percent", [12, 140])).toBe("percent");
    expect(effectiveHint("percent", [12, 151])).toBe("number");
  });

  it("passes every other hint through untouched", () => {
    expect(effectiveHint("currency", [2_297_175])).toBe("currency");
  });
});
