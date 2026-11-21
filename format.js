// Number and date formatting. Dates are ISO strings (YYYY-MM-DD) handled in UTC.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const int = (n) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
export const money = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
export const price = (n) =>
  n == null ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}
export const compactMoney = (n) => (n == null ? "—" : "$" + compact(n));
export const compactShares = compact;

export const toDate = (iso) => new Date(iso + "T00:00:00Z");
export const toISO = (d) => d.toISOString().slice(0, 10);
export const daysBetween = (a, b) => (toDate(b) - toDate(a)) / 86400000;

export function dayLabel(iso) {            // "Mon 19 Oct"
  const d = toDate(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export function shortDate(iso) {          // "13 Nov"
  const d = toDate(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export const monthName = (d) => MONTHS[d.getUTCMonth()];
export const monthYear = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export const rangeWords = (r) => (r === 365 ? "1 year" : `${r} days`);
