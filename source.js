// Where the page's data comes from. Locally: the /api endpoints of server.py. In the public,
// read-only copy (<html data-mode="static">): the JSON files export.py writes, fetched by
// relative path so the page works under any subpath. Stars are then the visitor's own, kept
// in this browser only.

export const isStatic = document.documentElement.dataset.mode === "static";

async function getJSON(path, body) {
  const opts = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined;
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText || `HTTP ${r.status}`);
  return data;
}

const live = {
  status: () => getJSON("/api/status"),
  flags: (range) => getJSON(`/api/flags?range=${range}`),
  history: (f) => getJSON(`/api/insider-history?cik=${encodeURIComponent(f.insider_cik)}&ticker=${encodeURIComponent(f.ticker)}&id=${f.id}`),
  search: (q) => getJSON(`/api/search?q=${encodeURIComponent(q)}`),
  watch: (ticker, on) => getJSON("/api/companies", { ticker, action: on ? "watch" : "unwatch" }),
  companyAction: (ticker, action, watch) => getJSON("/api/companies", { ticker, action, ...(watch === undefined ? {} : { watch }) }),
  saveRules: (body) => getJSON("/api/rules", body),
};

const STARS = "il-stars";
function readStars() {
  try {
    const v = JSON.parse(localStorage.getItem(STARS));
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}
function writeStars(list) {
  try { localStorage.setItem(STARS, JSON.stringify(list)); } catch { /* blocked storage: stars last until reload */ }
}

let base = null, companies = null, sessionStars = null;
const histories = new Map();   // ticker -> Promise of {flag id: payload}

const stat = {
  async status() {
    base ??= await getJSON("status.json");
    const watchlist = sessionStars ?? readStars() ?? base.default_watchlist;
    return { ...base, watchlist, added: [], running: null, error: null };
  },
  flags: (range) => getJSON(`flags-${range}.json`),
  async history(f) {
    if (!histories.has(f.ticker)) {
      const p = getJSON(`history/${encodeURIComponent(f.ticker)}.json`);
      histories.set(f.ticker, p);
      p.catch(() => histories.delete(f.ticker));   // let a later click retry
    }
    const h = (await histories.get(f.ticker))[String(f.id)];
    if (!h) throw new Error("not found");
    return h;
  },
  async search(q) {
    if (!companies) {
      // Every other SEC filer, so an untracked company is found and labelled as such.
      const [tracked, filers] = await Promise.all([getJSON("companies.json"), getJSON("filers.json").catch(() => [])]);
      companies = [...tracked.map((c) => ({ ...c, tracked: true })),
                   ...filers.map(([ticker, name]) => ({ ticker, name, sp500: false, tracked: false }))];
    }
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const watch = new Set((await stat.status()).watchlist);
    const hits = [];
    for (const c of companies) {
      const t = c.ticker.toLowerCase(), n = c.name.toLowerCase();
      if (!(t.startsWith(needle) || n.includes(needle))) continue;
      const rank = (t === needle ? 0 : t.startsWith(needle) ? 1 : 2) + (c.tracked ? 0 : 0.5);
      hits.push({ rank, c: { ...c, pending: false, watched: watch.has(c.ticker) } });
    }
    hits.sort((a, b) => a.rank - b.rank || a.c.ticker.length - b.c.ticker.length || a.c.ticker.localeCompare(b.c.ticker));
    return hits.slice(0, 12).map((h) => h.c);
  },
  async watch(ticker, on) {
    const now = new Set((await stat.status()).watchlist);
    on ? now.add(ticker) : now.delete(ticker);
    sessionStars = [...now].sort();
    writeStars(sessionStars);
    return stat.status();
  },
};

export const source = isStatic ? stat : live;
