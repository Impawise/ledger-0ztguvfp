// Insider Watch page. One state object, small render functions per section, no framework.

import { esc, int, money, price, compactMoney, shortDate, dayLabel, monthName, toDate, plural, rangeWords } from "./format.js";
import { panelShell, dynamicHTML, trendNote, tableHTML } from "./history.js";
import { source, isStatic } from "./source.js";
import { alertsFrom, isInsider, RULES } from "./alerts.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const phone = matchMedia("(max-width: 480px)");
const scrollBehavior = () => (reducedMotion.matches ? "auto" : "smooth");

const state = {
  status: null,
  data: null,                // flags payload for the current range
  range: isStatic ? (phone.matches ? 90 : 365) : 30,
  scope: "all",              // all | watch
  side: "both",              // both | buy | sell
  plan: "all",               // all | unplanned | planned (10b5-1)
  who: "all",                // all | insiders (officers and directors)
  filtersOpen: false,        // phone: the filter panel below scope and range
  sizeByPct: false,
  sort: "flags",
  sigma: { on: false, m: 2, mode: "larger" },
  ticker: null,
  flagId: null,
  numbersOpen: new Set(),
  histories: new Map(),      // flag id -> insider-history payload
  runTimer: null,
};

const rules = () => state.status.rules;
const T = () => ({ pct: rules().trend_pct, sigma: rules().trend_sigma });
// Draw for the range of the data in hand: a newer range may still be loading.
const shownRange = () => state.data?.range ?? state.range;


// ---- theme ---------------------------------------------------------------------------------

const THEMES = ["auto", "light", "dark"];
function currentTheme() {
  try { return localStorage.getItem("iw-theme") || "auto"; } catch { return "auto"; }
}
function setTheme(t) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem("iw-theme", t); } catch { /* private mode: theme just isn't remembered */ }
  for (const b of $$("#theme-switch button")) b.setAttribute("aria-pressed", String(b.value === t));
  const cycle = $("#theme-cycle");
  cycle.textContent = t[0].toUpperCase() + t.slice(1);
  cycle.setAttribute("aria-label", `Theme: ${t}. Change theme`);
}

// ---- derived view --------------------------------------------------------------------------

function passSigma(f) {
  const z = f.trend?.z;
  if (z == null) return false;
  const { m, mode } = state.sigma;
  return mode === "larger" ? z >= m : mode === "smaller" ? z <= -m : Math.abs(z) >= m;
}

const sideOk = (f) => state.side === "both" || f.side === state.side;
const planOk = (f) => state.plan === "all" || (state.plan === "planned") === Boolean(f.planned);

function view() {
  const watch = new Set(state.status.watchlist);
  const hidden = { plan: 0, scope: 0, sigma: 0, side: 0, who: 0 };
  const kept = [];
  for (const f of state.data?.flags ?? []) {
    if (state.scope === "watch" && !watch.has(f.ticker)) hidden.scope++;
    else if (state.who === "insiders" && !isInsider(f)) hidden.who++;
    else if (state.sigma.on && !passSigma(f)) hidden.sigma++;
    else kept.push(f);
  }
  // Each button's count is what it would show with the other filters as they are.
  const count = (keep) => kept.filter(keep).length;
  const counts = {
    buy: count((f) => planOk(f) && f.side === "buy"), sell: count((f) => planOk(f) && f.side === "sell"),
    unplanned: count((f) => sideOk(f) && !f.planned), planned: count((f) => sideOk(f) && f.planned),
  };
  const shown = kept.filter((f) => sideOk(f) && planOk(f));
  hidden.side = count((f) => planOk(f) && !sideOk(f));
  hidden.plan = count((f) => sideOk(f) && !planOk(f));

  const byTicker = new Map();
  for (const f of shown) {
    if (!byTicker.has(f.ticker)) byTicker.set(f.ticker, []);
    byTicker.get(f.ticker).push(f);
  }
  const metric = METRICS[state.sort];
  const companies = [...byTicker].map(([ticker, flags]) => ({ ticker, flags, key: metric.key(flags), label: metric.label(flags) }));
  companies.sort((a, b) => cmp(b.key, a.key) || b.flags.length - a.flags.length || a.ticker.localeCompare(b.ticker));
  const pending = state.status.added.filter((a) => a.state === "pending" && (state.scope === "all" || watch.has(a.ticker)));
  return { shown, counts, hidden, companies, pending, watch };
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const maxBy = (flags, fn) => flags.reduce((best, f) => (fn(f) > fn(best) ? f : best), flags[0]);

const METRICS = {
  flags: { key: (fs) => fs.length, label: (fs) => String(fs.length) },
  latest: { key: (fs) => fs.reduce((m, f) => (f.filed > m ? f.filed : m), ""), label: (fs) => shortDate(fs.reduce((m, f) => (f.filed > m ? f.filed : m), "")) },
  value: { key: (fs) => Math.max(...fs.map((f) => f.value ?? 0)), label: (fs) => compactMoney(Math.max(...fs.map((f) => f.value ?? 0))) },
  pct: {
    key: (fs) => Math.max(...fs.map((f) => f.pct ?? 0)),
    label: (fs) => {
      const f = maxBy(fs, (x) => x.pct ?? 0);
      return f.pct == null ? "—" : `${f.side === "buy" ? "+" : ""}${Math.round(f.pct)}%`;
    },
  },
  sigma: {
    key: (fs) => Math.max(-1, ...fs.map((f) => (f.trend?.z == null ? -1 : Math.abs(f.trend.z)))),
    label: (fs) => {
      const z = Math.max(-1, ...fs.map((f) => (f.trend?.z == null ? -1 : Math.abs(f.trend.z))));
      return z < 0 ? "no trend" : `${z.toFixed(1)}σ`;
    },
  },
};

// ---- header, toolbar ---------------------------------------------------------------------

function renderStatus() {
  const s = state.status;
  const added = s.added.length ? ` + ${s.added.length} added` : "";
  const through = s.through ? `indexes through ${s.through}` : "nothing loaded yet";
  $("#status-line").textContent = `${int(s.companies)} companies${added}, ${int(s.filings)} filings, ${through}`;
  renderRunNote();
}

function renderRunNote() {
  const { running: run, error } = state.status;
  const note = $("#run-note");
  note.hidden = !run && !error;
  note.classList.toggle("is-error", Boolean(error && !run));
  if (run) {
    const secs = Math.floor(run.elapsed + (Date.now() - run.seenAt) / 1000);
    note.textContent = `Running rules, ${secs} s so far.`;
  } else if (error) {
    note.textContent = `The last re-run failed: ${error}`;
  }
  $("#rules-save").disabled = Boolean(run);
}

function renderToolbar(v) {
  setPressed("#scope", state.scope);
  setPressed("#side", state.side);
  setPressed("#range", String(state.range));
  $("#watch-count").textContent = state.status.watchlist.length;
  $("#buy-count").textContent = v.counts.buy;
  $("#sell-count").textContent = v.counts.sell;
  setPressed("#plan", state.plan);
  setPressed("#who", state.who);
  $("#unplanned-count").textContent = v.counts.unplanned;
  $("#planned-count").textContent = v.counts.planned;
  const active = [state.side !== "both", state.plan !== "all", state.who !== "all", state.sigma.on].filter(Boolean).length;
  $("#filters-active").textContent = active ? `· ${active}` : "";
  $("#filters-toggle").setAttribute("aria-expanded", String(state.filtersOpen));
  $("#filters").classList.toggle("is-open", state.filtersOpen);
  $("#size-switch").setAttribute("aria-checked", String(state.sizeByPct));
  $("#sort").value = state.sort;
  $("#sigma-on").checked = state.sigma.on;
  $("#sigma-m").value = state.sigma.m;
  $("#sigma-mode").value = state.sigma.mode;
}

function setPressed(group, value) {
  for (const b of $$(`${group} button`)) b.setAttribute("aria-pressed", String(b.value === value));
}

// ---- time axis, strip, lanes ---------------------------------------------------------------

function axis() {
  const days = state.data.days;
  const n = days.length;
  const index = new Map(days.map((d, i) => [d, i]));
  const col = (iso) => {
    if (index.has(iso)) return index.get(iso);
    const i = days.findIndex((d) => d > iso);           // a non-trading date snaps forward
    return i < 0 ? n - 1 : i;
  };
  const weekStarts = weekStartsOf(days);
  const monthStarts = days.map((_, i) => i)
    .filter((i) => i > 0 && toDate(days[i]).getUTCMonth() !== toDate(days[i - 1]).getUTCMonth());
  const day = phone.matches ? shortDate : dayLabel;
  let grid, labels;
  if (shownRange() === 30) {
    grid = weekStarts;
    labels = weekStarts.map((i) => ({ i, text: day(days[i]) }));
  } else if (shownRange() === 90) {
    grid = weekStarts;
    labels = weekStarts.filter((_, k) => k % 2 === 0).map((i) => ({ i, text: day(days[i]) }));
  } else {
    grid = monthStarts;
    labels = monthStarts.map((i) => {
      const d = toDate(days[i]);
      return { i, text: d.getUTCMonth() === 0 ? `Jan ${d.getUTCFullYear()}` : monthName(d) };
    });
  }
  const width = $("#axis").clientWidth || 600;
  return { n, col, width, x: (iso) => ((col(iso) + 0.5) / n) * 100, edge: (i) => (i / n) * 100, grid, labels };
}

function renderStrip(v, ax) {
  // One bin per trading day, or per week at 1 year.
  const days = state.data.days;
  const starts = shownRange() === 365 ? [0, ...weekStartsOf(days)] : days.map((_, i) => i);
  const bins = starts.map((s, k) => ({ start: s, end: starts[k + 1] ?? days.length, buy: 0, sell: 0 }));
  const binOf = new Array(days.length);
  bins.forEach((b, k) => { for (let i = b.start; i < b.end; i++) binOf[i] = k; });
  for (const f of v.shown) bins[binOf[ax.col(f.traded)]][f.side]++;
  const max = Math.max(1, ...bins.map((b) => Math.max(b.buy, b.sell)));
  const tallest = parseFloat(getComputedStyle($("#strip")).getPropertyValue("--strip-max")) || 26;
  const px = (c) => Math.max(c ? 2 : 0, Math.round((c / max) * tallest));
  const bars = bins.map((b) => {
    const left = ax.edge(b.start).toFixed(3), width = (ax.edge(b.end) - ax.edge(b.start)).toFixed(3);
    const label = `${dayLabel(days[b.start])}: ${b.buy} buys, ${b.sell} sells`;
    return (b.buy ? `<span class="bar buy" style="left:${left}%;width:calc(${width}% - 2px);height:${px(b.buy)}px" title="${label}"></span>` : "")
      + (b.sell ? `<span class="bar sell" style="left:${left}%;width:calc(${width}% - 2px);height:${px(b.sell)}px" title="${label}"></span>` : "");
  }).join("");
  $("#strip").innerHTML = bars;
  $("#strip-label").textContent = shownRange() === 365 ? "Flags per week" : "Flags per day";
}

function weekStartsOf(days) {
  const out = [];
  days.forEach((d, i) => {
    if (!i) return;
    const prev = toDate(days[i - 1]), cur = toDate(d);
    if (cur.getUTCDay() <= prev.getUTCDay() || (cur - prev) / 86400000 >= 7) out.push(i);
  });
  return out;
}

const textWidth = (text, px = 11) => text.length * px * 0.58 + 8;   // rough, for overlap checks only

function renderAxis(ax) {
  let end = -Infinity;
  $("#axis").innerHTML = ax.labels
    .filter((l) => {
      const left = (ax.edge(l.i) / 100) * ax.width, right = left + textWidth(l.text);
      if (left < end || right > ax.width) return false;
      end = right + 4;
      return true;
    })
    .map((l) => `<span class="tick-label num" style="left:${ax.edge(l.i).toFixed(3)}%">${l.text}</span>`).join("");
}

const DOT_SCALE = { 30: 1, 90: 0.88, 365: 0.72 };
function dotSize(f) {
  let t;
  if (state.sizeByPct) t = Math.sqrt(Math.min(f.pct ?? 0, 100) / 100);
  else t = f.value ? (Math.log10(f.value) - 5) / (Math.log10(4e8) - 5) : 0;
  t = Math.min(1, Math.max(0, t));
  return (6 + 14 * t) * DOT_SCALE[shownRange()] * (phone.matches ? 0.85 : 1);
}

function dotLabel(f) {
  const what = f.side === "buy" ? "bought" : f.planned ? "sold under a 10b5-1 plan" : "sold";
  return `${f.ticker}: ${f.insider} ${what} ${int(f.shares)} shares, ${money(f.value)}, traded ${f.traded}`;
}

function laneDots(flags, ax) {
  const groups = new Map();
  for (const f of flags) {
    const k = `${ax.col(f.traded)}|${f.side}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const out = [];
  const countEnd = { buy: -Infinity, sell: -Infinity };
  const ordered = [...groups.values()].sort((a, b) => ax.col(a[0].traded) - ax.col(b[0].traded));
  for (const group of ordered) {
    group.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    let visible = group.slice(0, 3);
    const sel = group.find((f) => f.id === state.flagId);
    if (sel && !visible.includes(sel)) visible = [sel, ...visible.slice(0, 2)];
    const offsets = visible.length === 1 ? [0] : visible.length === 2 ? [-3.5, 3.5] : [-7, 0, 7];
    visible.forEach((f, k) => {
      const d = dotSize(f);
      const cy = f.side === "buy" ? 22 - d / 2 - 1 : 22 + d / 2 + 1;
      const selected = f.id === state.flagId;
      out.push(`<button type="button" class="dot ${f.side}${f.planned ? " planned" : ""}${selected ? " is-selected" : ""}"
        data-flag="${f.id}" tabindex="${selected ? 0 : -1}" aria-label="${esc(dotLabel(f))}"
        style="left:calc(${ax.x(f.traded).toFixed(3)}% + ${offsets[k]}px);top:${cy.toFixed(1)}px;width:${d.toFixed(1)}px;height:${d.toFixed(1)}px"></button>`);
    });
    const f = group[0], text = `×${group.length}`;
    const left = (ax.x(f.traded) / 100) * ax.width + 13;
    if (group.length >= 3 && shownRange() !== 365 && left >= countEnd[f.side]) {   // a year's day columns are too narrow to label
      countEnd[f.side] = left + textWidth(text) + 2;
      const top = f.side === "buy" ? 1 : 31;
      out.push(`<span class="dot-count num" style="left:calc(${ax.x(f.traded).toFixed(3)}% + 13px);top:${top}px">${text}</span>`);
    }
  }
  return out.join("");
}

function renderLanes(v, ax) {
  const lanes = $("#lanes");
  const msg = emptyMessage(v);
  const grid = ax.grid.map((i) => `<span class="gridline" style="left:${ax.edge(i).toFixed(3)}%"></span>`).join("");
  const pending = v.pending.map((p) => `<div class="lane pending">
      <div class="lane-label"><span class="ticker">${esc(p.ticker)}</span></div>
      <div class="pending-note"><span>${esc(p.name.replace(/\.+$/, ""))}. Filings for the last ${rules().lookback_days} days are pulled on the next re-run.</span>
        <button type="button" class="link-btn" data-remove="${esc(p.ticker)}">Remove</button></div>
    </div>`).join("");
  const rows = v.companies.map((c) => {
    const selected = c.ticker === state.ticker;
    const info = state.data.companies[c.ticker] ?? { name: c.ticker, sp500: true };
    const watched = v.watch.has(c.ticker);
    return `<div class="lane${selected ? " is-selected" : ""}" data-ticker="${esc(c.ticker)}" data-select="${esc(c.ticker)}">
      <div class="lane-label">
        <button type="button" class="star" data-star="${esc(c.ticker)}" aria-pressed="${watched}" tabindex="${selected ? 0 : -1}"
          aria-label="${watched ? "Remove" : "Add"} ${esc(c.ticker)} ${watched ? "from" : "to"} watchlist">${watched ? "★" : "☆"}</button>
        <button type="button" class="ticker" data-select="${esc(c.ticker)}" data-tip="${esc(info.name)}" tabindex="${selected ? 0 : -1}"
          aria-label="${esc(`${c.ticker}, ${info.name}, ${plural(c.flags.length, "flag")}`)}" aria-current="${selected}">${esc(c.ticker)}</button>
        <span class="metric num">${esc(c.label)}</span>
        ${info.sp500 ? "" : `<em class="added">Added</em>`}
      </div>
      <div class="track">${grid}${laneDots(c.flags, ax)}</div>
      ${selected ? aboutHTML(info.about, "lane-about") : ""}
    </div>`;
  }).join("");
  lanes.innerHTML = pending + (msg ? `<div class="empty">${msg}</div>` : rows);
}

function emptyMessage(v) {
  if (!state.status.filings) {
    if (isStatic) return `<p class="empty-title">No data published yet.</p>`;
    return `<p class="empty-title">No filings loaded yet.</p>
      <p>Insider Watch reads Form 4 filings for the S&amp;P 500 and the companies you add, then runs the rules over them.
      Run the rules once the filings have been pulled.</p>
      <button type="button" class="btn" data-action="run">Run rules</button>`;
  }
  if (v.companies.length) return "";
  if (state.scope === "watch" && !v.watch.size) {
    return `<p class="empty-title">Your watchlist is empty.</p>
      <p>${isStatic ? "Star a company in All tracked, or find one with Find a stock." : "Star a company in All tracked, or use Add company and tick “Also add to watchlist”."}</p>`;
  }
  if (state.sigma.on) {
    return `<p class="empty-title">No trades are that far from their insider’s trend.</p>
      <p>Trades whose insider has fewer than 4 earlier trades on the same side have no trend, so the σ filter leaves them out.
      Lower σ, or widen the range.</p>
      <button type="button" class="btn" data-action="clear">Clear filters</button>`;
  }
  const why = [];
  if (v.hidden.who) why.push(`showing officers and directors only is hiding ${plural(v.hidden.who, "flag")}`);
  if (v.hidden.plan) why.push(`showing ${state.plan} trades only is hiding ${plural(v.hidden.plan, "flag")}`);
  if (v.hidden.scope) why.push(`the Watchlist scope is hiding ${v.hidden.scope}`);
  if (v.hidden.side) why.push(`showing ${state.side === "buy" ? "buys" : "sells"} only is hiding ${v.hidden.side}`);
  const reason = why.length ? `${why.join("; ").replace(/^./, (c) => c.toUpperCase())}.` : `Nothing was flagged in the last ${rangeWords(shownRange())}.`;
  return `<p class="empty-title">No flags match these filters.</p><p>${reason}</p>
    ${why.length ? `<button type="button" class="btn" data-action="clear">Clear filters</button>` : ""}`;
}

// ---- detail list -------------------------------------------------------------------------

// What the company does: its S&P industry and the opening of its Wikipedia article.
function aboutHTML(ab, cls) {
  if (!ab) return "";
  return `<p class="${cls}">${ab.industry ? `<span class="industry">${esc(ab.industry)}</span>` : ""}${ab.industry && ab.text ? " · " : ""}${ab.text ? esc(ab.text) : ""}
      ${ab.url ? `<a href="${esc(ab.url)}" target="_blank" rel="noopener">Wikipedia <span aria-hidden="true">↗</span></a>` : ""}</p>`;
}

function renderDetail(v) {
  const detail = $("#detail");
  const company = v.companies.find((c) => c.ticker === state.ticker);
  if (!company) { detail.innerHTML = ""; return; }
  const info = state.data.companies[company.ticker];
  const flags = [...company.flags].sort((a, b) => cmp(b.traded, a.traded) || cmp(b.filed, a.filed) || b.id - a.id);
  const sum = (side) => {
    const fs = flags.filter((f) => f.side === side);
    return fs.length ? `${plural(fs.length, side === "buy" ? "buy" : "sell")} (${compactMoney(fs.reduce((s, f) => s + (f.value ?? 0), 0))})` : "";
  };
  const summary = [sum("buy"), sum("sell")].filter(Boolean).join(", ");
  detail.innerHTML = `<header class="detail-head">
      <h2><span class="ticker">${esc(company.ticker)}</span> <span class="company">${esc(info.name)}</span></h2>
      <p class="detail-summary">${summary} in ${rangeWords(shownRange())}, newest first</p>
      <p class="detail-hint">Choose a company on the left, or a dot, to change this list</p>
    </header>
    ${aboutHTML(info.about, "detail-about")}
    <div class="flag-list">${flags.map(flagRow).join("")}</div>`;
}

function flagRow(f) {
  const selected = f.id === state.flagId;
  const officer = f.officer ? "officer" : "";
  const twoRules = f.rules.length === 2;
  const numbersOpen = state.numbersOpen.has(f.id);
  const plan = f.planned
    ? `<span class="tag-planned">Planned · 10b5-1</span>`
    : f.side === "buy" ? `<span class="buy-note">Open-market buy</span>` : `<span>Unplanned</span>`;
  const history = selected ? panelShell(state.histories.get(f.id), T()) : trendNote(f.trend, f.side, T());
  return `<article class="flag ${f.side}${f.planned ? " planned" : ""}${selected ? " is-selected" : ""}" data-flag="${f.id}"
      tabindex="0" aria-current="${selected}" aria-label="${esc(f.reasons[0])}">
    <div class="flag-main">
      <p class="who">${esc(f.insider)}${f.title ? `, <span class="role ${officer}">${esc(f.title)}</span>` : ""}</p>
      <p class="trade num" title="${esc(f.reasons.join(" "))}">${f.side === "buy" ? "Bought" : "Sold"} ${int(f.shares)} at ${price(f.price)}${f.rows > 1 ? " avg" : ""}${f.before == null ? "" : ` · ${int(f.before)} → ${int(f.after)} shares`}</p>
      <div class="metrics">${pctRow(f)}${valueRow(f)}${sigmaRow(f)}${medianRow(f)}</div>
      <p class="meta">${plan}${twoRules ? `<span class="two-rules">Two rules, one sale</span>` : ""}
        ${f.rows > 1 ? `<span title="The filing lists this day's trades as ${f.rows} rows by price; they count as one ${f.side === "buy" ? "buy" : "sale"}.">${f.rows} rows, one day</span>` : ""}
        <span class="num">Traded ${f.traded}</span><span class="num">Filed ${f.filed}</span>
        <button type="button" class="link-btn numbers-toggle" aria-expanded="${numbersOpen}" aria-controls="numbers-${f.id}">Numbers <span aria-hidden="true">⌄</span></button>
        <a href="${esc(f.url)}" target="_blank" rel="noopener" class="edgar">EDGAR <span aria-hidden="true">↗</span></a></p>
      <dl class="numbers" id="numbers-${f.id}" ${numbersOpen ? "" : "hidden"}>${numbersHTML(f)}</dl>
    </div>
    ${history ? `<div class="flag-history">${history}</div>` : ""}
  </article>`;
}

// The card's four headline numbers as aligned rows: label, a bar with the rule's threshold
// tick, and the value. A row is coloured when its rule fired; a bar past its scale ends in ▸.
function metricRow({ cls = "", label, value, fired = false, bar = null, ticks = [], over = false, note = "", title = "" }) {
  const track = bar == null
    ? `<span class="m-note">${note}</span>`
    : `<span class="m-track"><span class="m-bar" style="left:${bar[0].toFixed(2)}%;width:${(bar[1] - bar[0]).toFixed(2)}%"></span>${ticks
        .map((t) => `<span class="m-tick" style="left:${t.at.toFixed(2)}%">${t.label ? `<span>${t.label}</span>` : ""}</span>`).join("")}${over ? `<span class="m-over" aria-hidden="true">▸</span>` : ""}</span>`;
  return `<div class="m-row ${cls}${fired ? " fired" : ""}"${title ? ` title="${esc(title)}"` : ""}>
    <span class="m-label">${label}</span>${track}<span class="m-value num">${value}</span></div>`;
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const fmtPct = (p) => `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;

function pctRow(f) {
  if (f.side === "buy") {
    if (!f.before) return metricRow({ label: "Added to position", value: "new", fired: true, bar: [0, 100], title: "They held none before" });
    return metricRow({ label: "Added to position", value: "+" + fmtPct(f.pct), fired: true, bar: [0, Math.min(f.pct, 100)], over: f.pct > 100 });
  }
  if (f.pct == null) return metricRow({ label: "Of position sold", value: "—", note: "not reported on the filing" });
  const X = rules().pct_threshold;
  return metricRow({ label: "Of position sold", value: fmtPct(f.pct), fired: f.rules.includes("sell_pct"),
                     bar: [0, Math.min(f.pct, 100)], ticks: [{ at: Math.min(X, 100), label: `${X}%` }] });
}

// Dollar value on a log scale centred on their median sale: the tick is "usual", each side 100×.
function valueRow(f) {
  const med = f.prior?.median_value;
  if (!med || !f.value) return metricRow({ cls: "neutral", label: "Dollar value", value: compactMoney(f.value), note: f.side === "sell" ? "no usual sale to compare" : "" });
  const pos = (v) => clamp(50 + (Math.log10(v / med) / 2) * 50, 0, 100);
  return metricRow({ cls: "neutral", label: "Dollar value", value: compactMoney(f.value),
                     bar: [pos(Math.min(f.value, med)), pos(Math.max(f.value, med))], over: f.value / med > 100,
                     ticks: [{ at: 50, label: `usual ${compactMoney(med)}` }] });
}

// Distance from their own trend (or average) in σ, on a symmetric scale with ±threshold ticks.
function sigmaRow(f) {
  const t = f.trend ?? {};
  const label = t.growth === null ? "σ from their average" : "σ from their trend";
  if (t.z == null) return metricRow({ cls: "m-sigma", label: "σ from their trend", value: "—", note: `no trend yet (${t.n ?? 0} of 4 trades)` });
  const S = T().sigma, R = Math.max(4, S * 2);
  const pos = (z) => 50 + (clamp(z, -R, R) / R) * 50;
  return metricRow({ cls: "m-sigma", label, value: `${t.z >= 0 ? "+" : "−"}${Math.abs(t.z).toFixed(1)}σ`, fired: Math.abs(t.z) >= S,
                     bar: [pos(Math.min(0, t.z)), pos(Math.max(0, t.z))], over: Math.abs(t.z) > R,
                     ticks: [{ at: pos(-S) }, { at: 50 }, { at: pos(S), label: `±${S}σ` }] });
}

const LOG_LO = Math.log(0.25), LOG_HI = Math.log(16);
const ratioPos = (r) => ((Math.log(clamp(r, 0.25, 16)) - LOG_LO) / (LOG_HI - LOG_LO)) * 100;

function medianRow(f) {
  const p = f.prior;
  if (f.side === "buy") return metricRow({ label: "× their median sale", value: "—", note: "not used for buys" });
  if (p.ratio == null) {
    return metricRow({ label: "× their median sale", value: "—",
                       note: `${plural(p.n, "prior sale")}; needs ${rules().min_prior_sales}` });
  }
  const N = rules().multiple;
  return metricRow({ label: "× their median sale", value: `${p.ratio.toFixed(1)}×`, fired: f.rules.includes("sell_vs_median"),
                     bar: [ratioPos(Math.min(1, p.ratio)), ratioPos(Math.max(1, p.ratio))], over: p.ratio > 16,
                     ticks: [{ at: ratioPos(N), label: `${N}×` }],
                     title: `Median ${int(p.median_shares)} shares (${compactMoney(p.median_value)}) over ${plural(p.n, "prior sale")}` });
}

const RULE_NAMES = {
  buy: () => "Open-market buy",
  sell_pct: () => `Over ${rules().pct_threshold}% of position`,
  sell_vs_median: () => `Over ${rules().multiple}× their median sale`,
};

function numbersHTML(f) {
  const p = f.prior ?? {};
  const rows = [
    ["Shares", int(f.shares)], ["Price", price(f.price)], ["Value", money(f.value)],
    [f.side === "buy" ? "Percent added" : "Percent sold", f.pct == null ? "—" : f.pct.toFixed(1) + "%"],
    ["Position before", int(f.before)], ["Position after", int(f.after)],
  ];
  if (f.side === "sell") {
    rows.push(["Prior sales", String(p.n)], ["Ratio to median", p.ratio == null ? "—" : p.ratio.toFixed(2) + "×"],
      ["Median shares", int(p.median_shares)], ["Median $", money(p.median_value)]);
  }
  rows.push(["Plan", f.planned ? "10b5-1" : "None"], ["Rules fired", f.rules.map((r) => RULE_NAMES[r]()).join("; ")]);
  return rows.map(([k, val]) => `<div><dt>${k}</dt><dd class="num">${esc(val)}</dd></div>`).join("");
}

function renderTrendViews() {
  for (const el of $$(".flag")) {
    const f = state.data.flags.find((x) => x.id === Number(el.dataset.flag));
    if (!f) continue;
    const sigma = $(".m-row.m-sigma", el);
    if (sigma) sigma.outerHTML = sigmaRow(f);
    if (f.id === state.flagId) {
      const h = state.histories.get(f.id);
      const dyn = $(".hp-dynamic", el);
      if (h && dyn) dyn.innerHTML = dynamicHTML(h, T());
    } else {
      const slot = $(".flag-history", el);
      const note = trendNote(f.trend, f.side, T());
      if (slot) slot.innerHTML = note;
      else if (note) el.insertAdjacentHTML("beforeend", `<div class="flag-history">${note}</div>`);
    }
  }
}

// ---- render all ------------------------------------------------------------------------

function render({ focus } = {}) {
  const v = view();
  if (!v.companies.some((c) => c.ticker === state.ticker)) {
    state.ticker = v.companies[0]?.ticker ?? null;
    state.flagId = null;
  }
  if (state.flagId != null && !v.shown.some((f) => f.id === state.flagId)) state.flagId = null;
  renderToolbar(v);
  if (state.data) {
    const ax = axis();
    renderStrip(v, ax);
    renderAxis(ax);
    renderLanes(v, ax);
  }
  renderDetail(v);
  document.body.classList.toggle("is-empty", !v.companies.length);
  if (focus) $(focus)?.focus({ preventScroll: true });
  return v;
}

// ---- selection -------------------------------------------------------------------------

function selectCompany(ticker, { focus = false } = {}) {
  if (ticker !== state.ticker) state.flagId = null;
  state.ticker = ticker;
  render({ focus: focus ? `.lane[data-ticker="${ticker}"] .ticker` : null });
  scrollLaneIntoView(ticker);
  $("#detail").scrollTo({ top: 0 });
}

async function selectFlag(id, { focus = null, scroll = false } = {}) {
  const f = state.data.flags.find((x) => x.id === id);
  if (!f) return;
  state.ticker = f.ticker;
  state.flagId = id;
  render({ focus });
  scrollLaneIntoView(f.ticker);
  if (scroll) scrollRowIntoView(id);
  if (!state.histories.has(id)) {
    try {
      const h = await source.history(f);
      state.histories.set(id, h);
    } catch (e) {
      const slot = $(`.flag[data-flag="${id}"] .history`);
      if (slot) slot.innerHTML = `<p class="hp-loading">Could not load their trades: ${esc(e.message)}</p>`;
      return;
    }
    if (state.flagId === id) {
      const slot = $(`.flag[data-flag="${id}"] .flag-history`);
      if (slot) slot.innerHTML = panelShell(state.histories.get(id), T());
    }
  }
}

function scrollLaneIntoView(ticker) {
  const lanes = $("#lanes"), lane = $(`.lane[data-ticker="${ticker}"]`);
  if (!lane) return;
  // Measured against the list, not offsetTop: the list isn't the lane's offsetParent.
  const top = lane.getBoundingClientRect().top - lanes.getBoundingClientRect().top + lanes.scrollTop;
  const bottom = top + lane.offsetHeight;
  if (top < lanes.scrollTop) lanes.scrollTo({ top, behavior: scrollBehavior() });
  else if (bottom > lanes.scrollTop + lanes.clientHeight) lanes.scrollTo({ top: bottom - lanes.clientHeight, behavior: scrollBehavior() });
}

function scrollRowIntoView(id) {
  const detail = $("#detail"), row = $(`.flag[data-flag="${id}"]`);
  if (!row) return;
  const head = $(".detail-head", detail)?.offsetHeight ?? 0;
  if (detail.scrollHeight > detail.clientHeight + 1) {
    detail.scrollTo({ top: row.offsetTop - head - 9, behavior: scrollBehavior() });
  } else {
    window.scrollTo({ top: row.getBoundingClientRect().top + window.scrollY - 12, behavior: scrollBehavior() });
  }
}

// ---- loading, running ------------------------------------------------------------------

async function loadStatus() {
  const s = await source.status();
  if (s.running) s.running.seenAt = Date.now();
  state.status = s;
  renderStatus();
  return s;
}

async function loadFlags() {
  state.data = await source.flags(state.range);
  render();
  renderAlertsBar();
}

// ---- worth a look ------------------------------------------------------------------------

const SEEN = "il-alerts-seen";
function readSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN)) || []); } catch { return new Set(); }
}
function writeSeen(keys) {
  try { localStorage.setItem(SEEN, JSON.stringify([...keys])); } catch { /* not remembered */ }
}
const currentAlerts = () => (state.data?.end ? alertsFrom(state.data.flags, state.data.end) : []);

function renderAlertsBar() {
  const alerts = currentAlerts(), seen = readSeen();
  const fresh = alerts.filter((a) => !seen.has(a.key)).length;
  const bar = $("#alerts-bar");
  bar.hidden = !alerts.length;
  $("#alerts-text").textContent = `${plural(alerts.length, "trade")} worth a look`;
  $("#alerts-new").textContent = fresh ? `${fresh} new` : "";
  bar.setAttribute("aria-label", `${plural(alerts.length, "trade")} worth a look, ${fresh} new. Open the list`);
}

function openAlerts() {
  const alerts = currentAlerts(), seen = readSeen();
  $("#alerts-note").textContent = `Filed in the ${RULES.recentDays} days to ${shortDate(state.data.end)}, strongest first.`;
  $("#alerts-list").innerHTML = alerts.map((a) => `<li><button type="button" class="alert-row ${a.side}" data-alert="${a.flagId}">
      <span class="ticker">${esc(a.ticker)}</span>
      <span class="alert-what">${esc(a.headline)}${a.detail ? ` <span class="alert-detail">· ${esc(a.detail)}</span>` : ""}
        <small>${esc(a.insider)} · filed ${shortDate(a.filed)}${seen.has(a.key) ? "" : ` <em class="alert-new">New</em>`}</small></span>
    </button></li>`).join("");
  $("#alerts-dialog").showModal();
  writeSeen(alerts.map((a) => a.key));   // shown once as new, then seen
  renderAlertsBar();
}

function watchRun() {
  clearInterval(state.runTimer);
  if (!state.status.running) return;
  let polls = 0;
  state.runTimer = setInterval(async () => {
    renderRunNote();
    if (++polls % 2) return;                           // poll every 2 s, tick every 1 s
    const s = await loadStatus().catch(() => null);
    if (s && !s.running) {
      clearInterval(state.runTimer);
      state.histories.clear();
      await loadFlags();
    }
  }, 1000);
}

async function runRules(body) {
  try {
    await source.saveRules({ ...body, rerun: true });
  } catch (e) {
    $("#rules-error").textContent = e.message;
    return false;
  }
  await loadStatus();
  watchRun();
  return true;
}

// ---- events ------------------------------------------------------------------------------

function wire() {
  for (const b of $$("#theme-switch button")) b.addEventListener("click", () => setTheme(b.value));
  $("#theme-cycle").addEventListener("click", () => setTheme(THEMES[(THEMES.indexOf(currentTheme()) + 1) % 3]));

  $("#scope").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.scope = b.value; render(); } });
  $("#side").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.side = b.value; render(); } });
  $("#range").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || Number(b.value) === state.range) return;
    state.range = Number(b.value);
    setPressed("#range", b.value);
    await loadFlags();
  });
  $("#who").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.who = b.value; render(); } });
  $("#plan").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.plan = b.value; render(); } });
  $("#filters-toggle").addEventListener("click", () => { state.filtersOpen = !state.filtersOpen; render(); });
  $("#size-switch").addEventListener("click", () => { state.sizeByPct = !state.sizeByPct; render(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  $("#sigma-on").addEventListener("change", (e) => { state.sigma.on = e.target.checked; render(); });
  $("#sigma-m").addEventListener("input", (e) => {
    const m = parseFloat(e.target.value);
    if (!(m > 0)) return;
    state.sigma.m = m;
    state.sigma.on = true;
    render();
  });
  $("#sigma-mode").addEventListener("change", (e) => { state.sigma.mode = e.target.value; state.sigma.on = true; render(); });

  // Lanes: clicks and keyboard.
  const lanes = $("#lanes");
  lanes.addEventListener("click", async (e) => {
    const dot = e.target.closest(".dot");
    if (dot) return selectFlag(Number(dot.dataset.flag), { focus: `.dot[data-flag="${dot.dataset.flag}"]`, scroll: true });
    const star = e.target.closest("[data-star]");
    if (star) return toggleWatch(star.dataset.star);
    const remove = e.target.closest("[data-remove]");
    if (remove) return companyAction(remove.dataset.remove, "remove");
    const action = e.target.closest("[data-action]");
    if (action?.dataset.action === "clear") return clearFilters();
    if (action?.dataset.action === "run") return runRules({});
    const sel = e.target.closest("[data-select]");
    if (sel) selectCompany(sel.dataset.select, { focus: e.target.closest(".ticker") != null });
  });
  lanes.addEventListener("keydown", onLaneKey);

  // Detail rows.
  const detail = $("#detail");
  detail.addEventListener("click", (e) => {
    const toggle = e.target.closest(".numbers-toggle");
    const more = e.target.closest(".hp-more, .hp-show");
    if (more) {
      const wrap = more.closest(".hp-table-wrap");
      wrap.innerHTML = tableHTML(state.histories.get(Number(more.dataset.history)), more.matches(".hp-more"));
      $("button, tbody tr", wrap)?.focus?.();
      return;
    }
    if (toggle) {
      const id = Number(toggle.closest(".flag").dataset.flag);
      const dl = $(`#numbers-${id}`);
      dl.hidden = !dl.hidden;
      toggle.setAttribute("aria-expanded", String(!dl.hidden));
      dl.hidden ? state.numbersOpen.delete(id) : state.numbersOpen.add(id);
      return;
    }
    if (e.target.closest("a, button, input, select, .history")) return;
    const row = e.target.closest(".flag");
    if (row) selectFlag(Number(row.dataset.flag), { focus: `.flag[data-flag="${row.dataset.flag}"]` });
  });
  detail.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".flag")) {
      e.preventDefault();
      selectFlag(Number(e.target.dataset.flag), { focus: `.flag[data-flag="${e.target.dataset.flag}"]` });
    }
  });
  detail.addEventListener("change", async (e) => {
    const input = e.target.closest(".hp-controls input");
    if (!input) return;
    const v = parseFloat(input.value);
    if (!(v > 0)) return;
    rules()[input.name] = v;
    renderTrendViews();
    if (state.sigma.on || state.sort === "sigma") render();
    if (!isStatic) source.saveRules({ [input.name]: v }).catch(() => {});   // public copy: this view only
  });

  // Edit rules dialog.
  const rulesDialog = $("#rules-dialog");
  $("#edit-rules").addEventListener("click", () => {
    for (const el of $("#rules-form").elements) if (el.name in rules()) el.value = rules()[el.name];
    $("#rules-error").textContent = "";
    rulesDialog.showModal();
  });
  $("#rules-form").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "save") return;
    e.preventDefault();
    const body = {};
    for (const el of e.target.elements) if (el.name) body[el.name] = el.value;
    if (await runRules(body)) rulesDialog.close();
  });

  // Add company dialog.
  const addDialog = $("#add-dialog");
  const openAdd = () => { $("#add-q").value = ""; $("#add-results").innerHTML = ""; addDialog.showModal(); };
  $("#add-company").addEventListener("click", openAdd);
  $("#add-phone").addEventListener("click", openAdd);
  $("#add-close").addEventListener("click", () => addDialog.close());
  let searchTimer;
  $("#add-q").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 150); });
  $("#add-results").addEventListener("click", async (e) => {
    const go = e.target.closest("button[data-go]");
    if (go && !goToCompany(go.dataset.go)) {
      go.closest("li").querySelector("small").textContent = `No flagged trades in the last ${rangeWords(shownRange())}.`;
      return;
    }
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const watch = b.dataset.act === "track" ? $("#add-watch").checked : undefined;
    await companyAction(b.dataset.ticker, b.dataset.act, watch);
    await search();
    $(`#add-results button[data-ticker="${b.dataset.ticker}"]`)?.focus();
  });

  phone.addEventListener("change", () => render());
  $("#alerts-bar").addEventListener("click", openAlerts);
  $("#alerts-close").addEventListener("click", () => $("#alerts-dialog").close());
  $("#alerts-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-alert]");
    if (!b) return;
    $("#alerts-dialog").close();
    Object.assign(state, { scope: "all", side: "both", plan: "all", who: "all" });
    state.sigma.on = false;
    selectFlag(Number(b.dataset.alert), { focus: `.flag[data-flag="${b.dataset.alert}"]`, scroll: true });
  });

  wireSplitter();
}

// ---- lanes / flag list divider -------------------------------------------------------------

const LANES_DEFAULT = 440, LANES_MIN = 88, DETAIL_MIN = 200;

function wireSplitter() {
  const lanes = $("#lanes"), splitter = $("#splitter");
  // The lanes may grow until the flag list below keeps DETAIL_MIN px of the window.
  const max = () => Math.max(LANES_MIN, window.innerHeight - lanes.getBoundingClientRect().top - DETAIL_MIN);
  const set = (h, save = true) => {
    h = Math.round(Math.min(max(), Math.max(LANES_MIN, h)));
    lanes.style.maxHeight = `${h}px`;
    splitter.setAttribute("aria-valuenow", String(h));
    splitter.setAttribute("aria-valuemin", String(LANES_MIN));
    splitter.setAttribute("aria-valuemax", String(Math.round(max())));
    if (save) try { localStorage.setItem("iw-lanes-h", String(h)); } catch { /* not remembered */ }
  };
  let saved = null;
  try { saved = Number(localStorage.getItem("iw-lanes-h")) || null; } catch { /* private mode */ }
  set(saved ?? LANES_DEFAULT, false);

  let startY = 0, startH = 0;
  const move = (e) => set(startH + e.clientY - startY);
  const stop = (e) => {
    splitter.releasePointerCapture(e.pointerId);
    splitter.classList.remove("is-dragging");
    document.body.classList.remove("is-resizing");
    splitter.removeEventListener("pointermove", move);
  };
  splitter.addEventListener("pointerdown", (e) => {
    startY = e.clientY;
    startH = lanes.getBoundingClientRect().height;
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add("is-dragging");
    document.body.classList.add("is-resizing");
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", stop, { once: true });
  });
  splitter.addEventListener("dblclick", () => set(LANES_DEFAULT));
  splitter.addEventListener("keydown", (e) => {
    const h = lanes.getBoundingClientRect().height;
    const step = e.shiftKey ? 120 : 30;
    const next = { ArrowUp: h - step, ArrowDown: h + step, Home: LANES_MIN, End: max() }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    set(next);
  });
}

function onLaneKey(e) {
  const order = $$("#lanes .lane[data-ticker]").map((l) => l.dataset.ticker);
  if (!order.length) return;
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    const i = order.indexOf(state.ticker);
    const next = order[Math.max(0, Math.min(order.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    selectCompany(next, { focus: true });
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    const v = view();
    const flags = (v.companies.find((c) => c.ticker === state.ticker)?.flags ?? [])
      .slice().sort((a, b) => cmp(a.traded, b.traded) || a.id - b.id);
    if (!flags.length) return;
    const i = flags.findIndex((f) => f.id === state.flagId);
    const j = i < 0 ? (e.key === "ArrowRight" ? 0 : flags.length - 1) : Math.max(0, Math.min(flags.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
    selectFlag(flags[j].id, { focus: `.dot[data-flag="${flags[j].id}"]`, scroll: true });
  }
}

function clearFilters() {
  Object.assign(state, { scope: "all", side: "both", plan: "all", who: "all" });
  state.sigma.on = false;
  render();
}

async function companyAction(ticker, action, watch) {
  try {
    state.status = action === "watch" || action === "unwatch"
      ? await source.watch(ticker, action === "watch")
      : await source.companyAction(ticker, action, watch);
    renderStatus();
    render();
  } catch (e) {
    alert(e.message);
  }
}

function toggleWatch(ticker) {
  const watched = state.status.watchlist.includes(ticker);
  return companyAction(ticker, watched ? "unwatch" : "watch").then(() => {
    $(`.lane[data-ticker="${ticker}"] .star`)?.focus({ preventScroll: true });
  });
}

// Public copy: jump from a search result to that company's lane, clearing filters that hide it.
function goToCompany(ticker) {
  if (!state.data.flags.some((f) => f.ticker === ticker)) return false;
  Object.assign(state, { scope: "all", side: "both", plan: "all", who: "all" });
  state.sigma.on = false;
  $("#add-dialog").close();
  selectCompany(ticker, { focus: true });
  return true;
}

async function search() {
  const q = $("#add-q").value.trim();
  const list = $("#add-results");
  if (!q) { list.innerHTML = ""; return; }
  const hits = await source.search(q);
  if (!hits.length) {
    list.innerHTML = `<li class="add-none">${isStatic ? `No SEC-listed company matches “${esc(q)}”.` : `No Form 4 filer matches “${esc(q)}”.`}</li>`;
    return;
  }
  list.innerHTML = hits.map((h) => {
    if (isStatic && !h.tracked) {
      return `<li><span class="ticker">${esc(h.ticker)}</span>
        <span class="add-name">${esc(h.name)}<small>Not tracked yet. Ask whoever shared this page to add it.</small></span><span></span></li>`;
    }
    if (isStatic) {
      return `<li><button type="button" class="link-btn ticker" data-go="${esc(h.ticker)}">${esc(h.ticker)}</button>
        <span class="add-name">${esc(h.name)}<small>${h.sp500 ? "S&P 500" : "Not in S&P 500"}</small></span>
        <button type="button" class="link-btn" data-act="${h.watched ? "unwatch" : "watch"}" data-ticker="${esc(h.ticker)}" aria-pressed="${h.watched}">
          <span aria-hidden="true">${h.watched ? "★" : "☆"}</span> ${h.watched ? "Starred" : "Star"}</button></li>`;
    }
    const where = h.sp500 ? "S&P 500, already tracked" : h.pending ? "Not in S&P 500, added, waiting for re-run" : h.tracked ? "Not in S&P 500, added" : "Not in S&P 500";
    const action = !h.tracked
      ? `<button type="button" class="btn" data-act="track" data-ticker="${esc(h.ticker)}">Track</button>`
      : `<button type="button" class="link-btn" data-act="${h.watched ? "unwatch" : "watch"}" data-ticker="${esc(h.ticker)}" aria-pressed="${h.watched}">
          <span aria-hidden="true">${h.watched ? "★" : "☆"}</span> ${h.watched ? "On watchlist" : "Add to watchlist"}</button>`;
    return `<li><span class="ticker">${esc(h.ticker)}</span><span class="add-name">${esc(h.name)}<small>${where}</small></span>${action}</li>`;
  }).join("");
}

// ---- start -------------------------------------------------------------------------------

async function start() {
  if (isStatic) {
    $("#add-company").innerHTML = `<span aria-hidden="true">⌕</span> Find a stock`;
    $("#add-phone").textContent = "⌕";
    $("#add-phone").setAttribute("aria-label", "Find a stock");
  }
  setTheme(currentTheme());
  wire();
  try {
    await loadStatus();
    await loadFlags();
    watchRun();
  } catch (e) {
    const what = isStatic ? "Could not load the data." : "Could not reach the server.";
    $("#lanes").innerHTML = `<div class="empty"><p class="empty-title">${what}</p><p>${esc(e.message)}</p></div>`;
  }
}

start();
