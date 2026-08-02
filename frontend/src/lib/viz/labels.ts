const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Calendar label for a temporal bucket: month buckets read "Jan 23", day
 * buckets "5 Mar". Falls back to the raw string when the cell is not a
 * parseable timestamp. Rendered in UTC — buckets are UTC wall-clock and a
 * viewer's timezone must never shift one.
 */
export function temporalLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (d.getUTCDate() === 1 && d.getUTCHours() === 0) {
    return `${MONTH_SHORT[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  }
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}
