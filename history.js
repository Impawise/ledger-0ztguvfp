// The insider history panel: trend flags, the signed-log scatterplot and the trade table.
// The fit itself comes from the server (feed.trend_fit); this module only judges it against
// the trend thresholds and draws it.

import { esc, int, price, money, compactShares, toDate, daysBetween, monthYear, plural } from "./format.js";

export const FLAG_ICON =
  '<svg class="flag-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 11V1.5M2.5 2h6.5l-1.5 2.5L9 7H2.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

const noun = (side) => (side === "buy" ? "buy" : "sale");
const nouns = (side) => (side === "buy" ? "Buys" : "Sales");

// Which trend flags fire for a fit, worded by size: sells plot downward, so never "above".
export function trendFlags(fit, side, T) {
  if (!fit || fit.z == null) return [];
  const out = [];
  const steep = 1 + T.pct / 100;
  if (Math.abs(fit.z) >= T.sigma) {
    out.push(`This ${noun(side)} is ${Math.abs(fit.z).toFixed(1)}σ ${fit.z > 0 ? "larger" : "smaller"} than their ${fit.growth == null ? "average" : "trend"}`);
  }
  if (fit.growth == null) return out;   // too bunched in time for a slope: compared with the mean
  if (fit.growth >= steep) out.push(`${nouns(side)} growing ${Math.round((fit.growth - 1) * 100)}% a year`);
  else if (fit.growth <= 1 / steep) out.push(`${nouns(side)} shrinking ${Math.round((1 - fit.growth) * 100)}% a year`);
  return out;
}

// One-line note for a Flag Row whose panel is closed.
export function trendNote(fit, side, T) {
  const flags = trendFlags(fit, side, T);
  if (!flags.length) return "";
  const text = flags.map((f) => f.replace(/^This (sale|buy) is /, "")).join(" · ");
  return `<p class="trend-note">${FLAG_ICON}<span>${esc(text)}</span></p>`;
}

export function panelShell(h, T) {
  if (!h) return `<div class="history"><p class="hp-loading">Loading their trades…</p></div>`;
  return `<div class="history" data-history="${h.id}">
    <div class="hp-dynamic">${dynamicHTML(h, T)}</div>
    <p class="hp-controls">Flag when the trend is steeper than ±
      <input class="num" type="number" name="trend_pct" min="1" step="any" value="${T.pct}" aria-label="Trend steepness threshold, percent a year">
      % a year, or a trade is more than
      <input class="num" type="number" name="trend_sigma" min="0.1" step="any" value="${T.sigma}" aria-label="Distance from trend threshold, sigma">
      σ from it.</p>
    <div class="hp-table-wrap"><button type="button" class="link-btn hp-show" data-history="${h.id}">Show their ${plural(h.trades.length, "trade")}</button></div>
  </div>`;
}

// The parts that change when a trend threshold is edited (inputs stay put, keeping focus).
export function dynamicHTML(h, T) {
  const f = h.fit;
  const flags = trendFlags(f, h.side, T);
  const priorWord = h.side === "buy" ? "buys" : "sales";
  const counts = `${plural(h.counts.sales, "sale")}, ${plural(h.counts.buys, "buy")}`;
  let fitInfo;
  if (f.z == null) {
    fitInfo = `<p class="hp-fit">Not enough prior ${priorWord} for a trend (${f.n} of 4 needed)</p>`;
  } else if (f.growth == null) {
    fitInfo = `<p class="hp-fit">No trend: prior ${priorWord} are too close together in time to project a slope this far,
      so this is compared with their average<br><span class="hp-stats">n = <span class="num">${f.n}</span>, this ${noun(h.side)} is
      <span class="num">${Math.abs(f.z).toFixed(1)}σ</span> ${f.z >= 0 ? "larger" : "smaller"} than average</span></p>`;
  } else {
    const g = Math.round((f.growth - 1) * 100);
    fitInfo = `<p class="hp-fit">Trend in ${noun(h.side)} size: <span class="num">${g > 0 ? "+" : g < 0 ? "−" : ""}${Math.abs(g)}%</span> a year
      (<span class="num">${f.growth.toFixed(1)}×</span>)<br><span class="hp-stats">n = <span class="num">${f.n}</span>,
      R² <span class="num">${f.r2 == null ? "—" : f.r2.toFixed(2)}</span>, this ${noun(h.side)} is
      <span class="num">${Math.abs(f.z).toFixed(1)}σ</span> ${f.z >= 0 ? "larger" : "smaller"} than trend</span></p>`;
  }
  return `<h3 class="hp-title">${esc(h.insider)}’s trades in ${esc(h.ticker)}</h3>
    <p class="hp-summary">Before this filing, last ${h.lookback_days} days: ${counts}. Buys above zero, sells below,
      shares on a log scale; the line fits prior ${priorWord}, the band is ±${T.sigma}σ.</p>
    <div class="hp-flags">${flags.map((t) => `<span class="flag-tag">${FLAG_ICON}${esc(t)}</span>`).join("")}${fitInfo}</div>
    ${chartHTML(h, T, flags.length > 0)}`;
}

const TABLE_ROWS = 40;   // some insiders file thousands of rows in two years

export function tableHTML(h, all = false) {
  const trades = all ? h.trades : h.trades.slice(0, TABLE_ROWS);
  const more = all || h.trades.length <= TABLE_ROWS ? ""
    : `<button type="button" class="link-btn hp-more" data-history="${h.id}">Show all ${int(h.trades.length)} trades</button>`;
  const rows = trades.map((t) => `<tr class="${t.this ? "is-this" : ""}">
      <td class="c-date num">${t.date}</td>
      <td class="c-side ${t.side}-ink">${t.side === "buy" ? "Buy" : "Sell"}</td>
      <td class="c-shares num">${int(t.shares)}</td>
      <td class="c-price num">${price(t.price)}</td>
      <td class="c-value num">${money(t.value)}</td>
      <td class="c-ratio num">${t.ratio == null ? "" : t.ratio.toFixed(1) + "×"}</td>
      <td class="c-note">${t.this ? "This filing" : t.flagged ? "Flagged" : ""}${t.planned ? (t.this || t.flagged ? ", planned" : "Planned") : ""}</td>
    </tr>`).join("");
  return `<table class="hp-table">
    <thead><tr><th class="c-date">Date</th><th class="c-side">Side</th><th class="c-shares">Shares</th><th class="c-price">Price</th>
      <th class="c-value">Value</th><th class="c-ratio">× median</th><th class="c-note">Note</th></tr></thead>
    <tbody>${rows}</tbody></table>${more}`;
}

// ---- chart -------------------------------------------------------------------------------

function yTicks(base, top, bottom, y) {
  const out = [];
  for (const sign of [1, -1]) {
    const cands = [];
    for (let k = 0; k <= 9; k++) for (const m of [1, 2, 5]) cands.push(m * 10 ** k);
    const kept = [];
    const vals = cands
      .map((s) => ({ s, v: sign * (Math.log10(s) - base) }))
      .filter(({ v }) => v * sign > 0 && v <= top && v >= bottom)
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    for (const c of vals) {
      const yy = y(c.v);
      if (yy < 0.06 || yy > 0.94 || Math.abs(yy - y(0)) < 0.12) continue;
      if (kept.some((k) => Math.abs(y(k.v) - yy) < 0.12)) continue;
      kept.push(c);
      if (kept.length === 3) break;
    }
    for (const c of kept) out.push({ y: y(c.v), label: (sign > 0 ? "+" : "−") + compactShares(c.s) });
  }
  return out;
}

function chartHTML(h, T, fires) {
  const sideSign = (side) => (side === "buy" ? 1 : -1);
  const signed = (log, side) => sideSign(side) * (log - h.base);
  const total = daysBetween(h.start, h.end) || 1;
  const x = (iso) => daysBetween(h.start, iso) / total;
  const vals = h.trades.map((t) => signed(Math.log10(t.shares), t.side));
  let top = Math.max(0, ...vals), bottom = Math.min(0, ...vals);
  const span = top - bottom || 1;
  top = Math.max(top, span * 0.18) * 1.08;
  bottom = Math.min(bottom, -span * 0.18) * 1.08;
  const y = (v) => (top - v) / (top - bottom);
  const pc = (n) => (n * 100).toFixed(3);

  // Gridlines every 6 months back from this trade's month.
  const end = toDate(h.end);
  const grid = [];
  for (let m = 0; ; m += 6) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - m, 1));
    const gx = x(d.toISOString().slice(0, 10));
    if (gx < 0) break;
    grid.push({ x: gx, label: monthYear(d) });
  }

  const svg = [];
  for (const g of grid) svg.push(`<line class="c-grid" x1="${pc(g.x)}" x2="${pc(g.x)}" y1="0" y2="100"/>`);
  svg.push(`<line class="c-zero" x1="0" x2="100" y1="${pc(y(0))}" y2="${pc(y(0))}"/>`);
  if (h.side === "sell" && h.median_shares) {
    const my = pc(y(signed(Math.log10(h.median_shares), "sell")));
    svg.push(`<line class="c-median" x1="0" x2="100" y1="${my}" y2="${my}"/>`);
  }

  const f = h.fit;
  const same = h.trades.filter((t) => !t.this && t.side === h.side);
  if (f.z != null && same.length) {
    const first = same[same.length - 1].date;
    const yrs0 = -daysBetween(first, h.end) / 365.25;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const yrs = yrs0 * (1 - i / 24);
      const px = 1 + (yrs * 365.25) / total;
      const pred = f.intercept + f.slope * yrs;
      const band = T.sigma * f.sd;
      pts.push({ px, mid: pred, hi: pred + band, lo: Math.max(pred - band, h.base) });
    }
    const line = pts.map((p) => `${pc(p.px)},${pc(y(signed(p.mid, h.side)))}`).join(" ");
    const upper = pts.map((p) => `${pc(p.px)},${pc(y(signed(p.hi, h.side)))}`);
    const lower = pts.map((p) => `${pc(p.px)},${pc(y(signed(p.lo, h.side)))}`).reverse();
    svg.push(`<polygon class="c-band" points="${upper.concat(lower).join(" ")}"/>`);
    svg.push(`<polyline class="c-fit${fires ? " fires" : ""}" points="${line}"/>`);
  }

  const dots = h.trades.map((t) => {
    const cls = t.this ? "this" : t.side === h.side ? "solid" : "hollow";
    const label = `${t.date}: ${t.side === "buy" ? "bought" : "sold"} ${int(t.shares)} shares`;
    return `<span class="c-dot ${t.side} ${cls}" style="left:${pc(x(t.date))}%;top:${pc(y(signed(Math.log10(t.shares), t.side)))}%" title="${esc(label)}"></span>`;
  }).join("");
  const thisT = h.trades.find((t) => t.this);
  const thisY = y(signed(Math.log10(thisT.shares), thisT.side));
  const thisLabel = `<span class="c-this-label" style="top:${pc(thisY)}%">This ${noun(h.side)}</span>`;
  const median = h.side === "sell" && h.median_shares
    ? `<span class="c-median-label num" style="top:${pc(y(signed(Math.log10(h.median_shares), "sell")))}%">Median ${int(h.median_shares)}</span>`
    : "";
  const ticks = yTicks(h.base, top, bottom, y)
    .map((t) => `<span class="c-ytick num" style="top:${pc(t.y)}%">${t.label}</span>`).join("");
  const xlabels = grid.filter((g) => g.x <= 0.88)
    .map((g) => `<span class="c-xlabel num" style="left:${pc(g.x)}%">${g.label}</span>`).join("");

  return `<div class="chart" role="img" aria-label="${esc(`${h.insider}'s ${h.trades.length} trades in ${h.ticker} over ${h.lookback_days} days, on a log scale`)}">
    <div class="c-gutter">${ticks}</div>
    <div class="c-plot">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${svg.join("")}</svg>
      <span class="c-side-label buy-ink" style="top:2%">Bought</span>
      <span class="c-side-label sell-ink" style="bottom:2%">Sold</span>
      ${median}${dots}${thisLabel}
    </div>
    <div></div><div class="c-xaxis">${xlabels}</div>
  </div>`;
}
