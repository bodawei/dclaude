// LAYER 3: PRESENTATION. Shared formatting helpers.
//
// Small text helpers used by more than one presenter (markdown.mjs, csv.mjs, tail.mjs): times,
// durations, numbers, money, and shortening text to fit. Pure functions, no I/O.

import { homedir } from "node:os";

const pad = (n) => String(n).padStart(2, "0");

/** Local time as "2026-11-27 02:26:59", or the date alone; "—" when there is no time. */
function fmtTime(iso, withTime = true) {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime
    ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    : date;
}

/** Local time as 2026-11-27T02:26:59. */
const isoStamp = (iso) => fmtTime(iso).replace(" ", "T");

/** Seconds from a to b with one decimal, or `missing` when either time is absent. */
const secs = (a, b, missing = "—") =>
  a && b ? ((new Date(b) - new Date(a)) / 1000).toFixed(1) : missing;

const fmt = (n) => n.toLocaleString("en-US");

/** Whitespace collapsed, "|" escaped for Markdown tables, cut to n characters. */
const clean = (s, n = 100) => {
  s = s.split(/\s+/).join(" ").trim().replaceAll("|", "\\|");
  return s.length > n ? s.slice(0, n) + "…" : s;
};

/** The distinct values of one key across calls, sorted and comma-joined; "—" when none. */
const joined = (calls, key) => [...new Set(calls.map((c) => c[key]))].toSorted().join(", ") || "—";

/** Union of the calls' flags, in first-seen order. */
const turnFlags = (calls) => [...new Set(calls.flatMap((c) => c.flags))].join(", ");

const home = homedir();
const tilde = (p) => (p.startsWith(home) ? "~" + p.slice(home.length) : p);

/** Exactly w characters: padded, or cut with "…". */
const fit = (s, w) => (w <= 0 ? "" : s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w));

const dollars = (n) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$1.23", or "?" for an unknown (null) cost. */
const money = (c) => (c == null ? "?" : "$" + dollars(c));

const WINDOW_NAMES = { "5h": "5-hour window", week: "weekly window", month: "month" };

/**
 * A --window Window as text, in local time: "5-hour window: 35% used, 2026-11-27 12:29 →
 * 17:29" (the end's date left out when it is the start's), "month: 2026-11-01 → 2026-12-01",
 * "5-hour window: 0% used, none open", or, with `error` set, "5-hour window: can't retrieve".
 */
function windowText(w) {
  const name = WINDOW_NAMES[w.kind];
  if (w.error) return `${name}: can't retrieve`;
  if (w.kind === "month") {
    return `${name}: ${fmtTime(w.start.toISOString(), false)} → ${fmtTime(w.end.toISOString(), false)}`;
  }

  const used = `${name}: ${w.percent}% used`;
  if (!w.end) return `${used}, none open`;
  const from = fmtTime(w.start.toISOString()).slice(0, 16);
  const to = fmtTime(w.end.toISOString()).slice(0, 16);

  return `${used}, ${from} → ${to.slice(0, 10) === from.slice(0, 10) ? to.slice(11) : to}`;
}

export { clean, fit, fmt, fmtTime, isoStamp, joined, money, secs, tilde, turnFlags, windowText };
