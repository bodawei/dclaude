// LAYER 2: TRANSFORMATION. The time window --window filters to.
//
// Turns a Usage from lib/load/usage.mjs (or, for the calendar month, nothing) into the window
// whose turns the reports show: when it started, when it ends, and the percentage used.
// Pure functions: the caller passes `now`. Imports nothing from lib/present/.

/**
 * Shape returned by this file:
 *   Window  { kind: "5h" | "week" | "month", start: Date, end: Date | null,
 *             percent: number | null }
 *   end null: no 5-hour or weekly window is open; start is then `now`, so only turns after
 *   it (the ones that open the next window) are shown. percent null: the calendar month,
 *   which has no quota.
 */

const KINDS = ["5h", "week", "month"];

const LENGTH = { "5h": 5 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000 };

/** The Window of `kind`. `usage` is the Usage for "5h" and "week", and unused for "month". */
function windowOf(kind, usage, now) {
  if (kind === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return { kind, start, end, percent: null };
  }

  if (!usage.resetsAt) return { kind, start: now, end: null, percent: usage.percent };

  return {
    kind,
    start: new Date(usage.resetsAt.getTime() - LENGTH[kind]),
    end: usage.resetsAt,
    percent: usage.percent,
  };
}

export { KINDS, windowOf };
