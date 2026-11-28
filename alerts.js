// "Worth a look": recent trades by a company's own officers and directors that stand out.
// Only unplanned trades count; 10% owners, funds and companies are left out. Buys lead, since
// the backtest in NOTES.md found the signal there. Sells need one person dumping most of a
// large stake: several insiders selling together is mostly the routine selling that follows
// earnings (54 alerts in two weeks of real data when sell clusters counted).

import { daysBetween, compactMoney, plural } from "./format.js";

export const RULES = {
  recentDays: 14,          // filed within this many days of the latest data
  clusterDays: 21,         // insiders trading the same side within this window form a cluster
  buyCluster: 2,           // distinct officers/directors buying
  bigBuy: 250_000,         // one buy at least this many dollars
  stakeBuyPct: 25,         // …or adding at least this % to their stake, if at least stakeBuyMin
  stakeBuyMin: 100_000,
  bigSellPct: 75,          // one sale of at least this % of their stake… (execs hold much of theirs as options)
  bigSellMin: 5_000_000,   // …worth at least this
};

export const isInsider = (f) => f.officer || f.director;

const role = (f) => (f.officer ? (f.title && !/remarks/i.test(f.title) ? f.title : "Officer") : f.director ? "Director" : "Insider");
const sum = (fs) => fs.reduce((s, f) => s + (f.value ?? 0), 0);

// One alert per company and side: { key, ticker, side, level, headline, detail, flagId, filed }.
export function alertsFrom(flags, end) {
  const eligible = flags.filter((f) => isInsider(f) && !f.planned);
  const groups = new Map();
  for (const f of eligible) {
    const k = `${f.ticker}|${f.side}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const out = [];
  for (const fs of groups.values()) {
    const recent = fs.filter((f) => daysBetween(f.filed, end) <= RULES.recentDays);
    if (!recent.length) continue;
    const { ticker, side } = recent[0];
    const latest = recent.reduce((a, b) => (b.filed > a.filed || (b.filed === a.filed && (b.value ?? 0) > (a.value ?? 0)) ? b : a));
    // The cluster around the latest recent trade: same side, traded within clusterDays.
    const cluster = fs.filter((f) => Math.abs(daysBetween(f.traded, latest.traded)) <= RULES.clusterDays);
    const people = new Set(cluster.map((f) => f.insider_cik)).size;
    const verb = side === "buy" ? "bought" : "sold";
    let alert = null;
    if (side === "buy" && people >= RULES.buyCluster) {
      alert = { level: 3, headline: `${people} insiders ${verb} within ${RULES.clusterDays} days`,
                detail: `${compactMoney(sum(cluster))} in ${plural(cluster.length, "trade")}` };
    } else if (side === "buy") {
      const big = recent.filter((f) => (f.value ?? 0) >= RULES.bigBuy ||
        ((f.value ?? 0) >= RULES.stakeBuyMin && (f.before === 0 || (f.pct ?? 0) >= RULES.stakeBuyPct)));
      if (big.length) {
        const f = big.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a));
        alert = { level: 2, flag: f, headline: `${role(f)} bought ${compactMoney(f.value)}`,
                  detail: f.before === 0 ? "a new position" : f.pct == null ? "" : `+${Math.round(f.pct)}% to their stake` };
      }
    } else {
      const big = recent.filter((f) => (f.pct ?? 0) >= RULES.bigSellPct && (f.value ?? 0) >= RULES.bigSellMin);
      if (big.length) {
        const f = big.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a));
        alert = { level: 1, flag: f, headline: `${role(f)} sold ${Math.round(f.pct)}% of their stake`,
                  detail: compactMoney(f.value) };
      }
    }
    if (!alert) continue;
    const f = alert.flag ?? latest;
    out.push({ key: `${ticker}|${side}|${f.id}`, ticker, side, level: alert.level, headline: alert.headline,
               detail: alert.detail, flagId: f.id, filed: f.filed, insider: f.insider });
  }
  return out.sort((a, b) => b.level - a.level || (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0) || a.ticker.localeCompare(b.ticker));
}
