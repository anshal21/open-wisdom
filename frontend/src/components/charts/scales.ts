/** Scale + tick helpers. No chart library — SVG under ~2000 marks. */

export interface LinearScale {
  (v: number): number;
  domain: [number, number];
  range: [number, number];
  ticks: number[];
  invert: (px: number) => number;
}

export function linear(
  domain: [number, number],
  range: [number, number],
  tickCount = 4,
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const fn = ((v: number) => r0 + ((v - d0) / span) * (r1 - r0)) as LinearScale;
  fn.domain = domain;
  fn.range = range;
  fn.ticks = niceTicks(d0, d1, tickCount);
  fn.invert = (px: number) => d0 + ((px - r0) / (r1 - r0)) * span;
  return fn;
}

/** 3–5 ticks, never more. data-viz.md §4. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) {
    out.push(Math.round(v / step) * step);
  }
  return out;
}

/**
 * Zero baseline is mandatory for bars and columns; lines may float but must
 * annotate. The caller passes `zeroBaseline`.
 */
export function domainFor(
  values: number[],
  zeroBaseline: boolean,
): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [0, 1];
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (zeroBaseline) min = Math.min(0, min);
  if (min === max) {
    max = max === 0 ? 1 : max * 1.1;
    if (zeroBaseline) min = 0;
  } else if (!zeroBaseline) {
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
  }
  return [min, max];
}

export interface BandScale {
  (i: number): number;
  bandwidth: number;
  step: number;
}

export function band(count: number, range: [number, number], padding = 0.32): BandScale {
  const [r0, r1] = range;
  const step = count > 0 ? (r1 - r0) / count : 0;
  const bandwidth = Math.max(1, step * (1 - padding));
  const fn = ((i: number) => r0 + i * step + (step - bandwidth) / 2) as BandScale;
  fn.bandwidth = bandwidth;
  fn.step = step;
  return fn;
}

/** Bars are thin: ≤60% of the band, min 6px, max 32px. data-viz.md §3 */
export function barThickness(step: number): number {
  return Math.max(6, Math.min(32, step * 0.6));
}

export function path(points: Array<[number, number]>): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${round(p[0])} ${round(p[1])}`)
    .join(" ");
}

export function areaPath(
  points: Array<[number, number]>,
  baseline: number,
): string {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${path(points)} L${round(last[0])} ${round(baseline)} L${round(first[0])} ${round(baseline)} Z`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Rounded corners on the data end only; the baseline end is square. */
export function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r = 4,
  orientation: "up" | "right" = "up",
): string {
  const radius = Math.min(r, orientation === "up" ? w / 2 : h / 2, orientation === "up" ? h : w);
  if (radius <= 0.5) return `M${x} ${y} h${w} v${h} h${-w} Z`;
  if (orientation === "up") {
    return `M${round(x)} ${round(y + h)} V${round(y + radius)} Q${round(x)} ${round(y)} ${round(x + radius)} ${round(y)} H${round(x + w - radius)} Q${round(x + w)} ${round(y)} ${round(x + w)} ${round(y + radius)} V${round(y + h)} Z`;
  }
  return `M${round(x)} ${round(y)} H${round(x + w - radius)} Q${round(x + w)} ${round(y)} ${round(x + w)} ${round(y + radius)} V${round(y + h - radius)} Q${round(x + w)} ${round(y + h)} ${round(x + w - radius)} ${round(y + h)} H${round(x)} Z`;
}

/** Slot index is bound to a stable entity key, never to array position. */
export function seriesSlot(key: string, keys: string[]): number {
  const i = keys.indexOf(key);
  return (i < 0 ? 0 : i) % 8;
}

export const VIZ_SLOT = (i: number) => `var(--viz-${(i % 8) + 1})`;
