// LAYER 1: LOADING. Plan usage from Claude Code's /usage command (--window 5h, --window week).
//
// Runs `claude -p /usage` and decodes the lines it prints for the current 5-hour session and
// the current week (all models): the percentage used and when it resets. /usage prints them
// only as text meant for a reader, so this parses that text, and throws when it can't.
//
// Claude Code is run with TZ=UTC, so the reset times are printed in UTC. It is run with hooks
// and MCP servers off, and without saving a session, so the call adds no transcript for
// dclaude to read back. /usage makes no model call and uses none of the quota.
//
// This layer does not total, filter or name anything, and it never prints, reads the clock or
// exits: the caller passes `now`, used only to work out the year a reset date falls in.

import { execFile } from "node:child_process";
import { homedir } from "node:os";

/**
 * Shape returned by this file:
 *   Usage  { percent: number, resetsAt: Date | null }   resetsAt null: no window open
 */

const LINES = {
  "5h": { name: "Current session", re: /^Current session: (\d+)% used(?: · resets (.+))?$/m },
  week: {
    name: "Current week (all models)",
    re: /^Current week \(all models\): (\d+)% used(?: · resets (.+))?$/m,
  },
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// "Nov 28 at 1:30am (UTC)", "Nov 28 at 2am (UTC)" or, without a date, "1:30am (UTC)".
const RESET_RE = /^(?:([a-z]{3})[a-z]* (\d{1,2}),? at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm) \(UTC\)$/i;

const DAY = 24 * 60 * 60 * 1000;

/**
 * A /usage reset time as a Date. It has no year (or no date at all), so of the candidates
 * around `now` the one closest to it wins.
 */
function parseReset(text, now) {
  const m = text.trim().match(RESET_RE);
  if (!m) throw new Error(`can't read the reset time "${text}" from claude /usage`);
  const [, mon, day, h, min = "0", ampm] = m;
  const hour = (Number(h) % 12) + (ampm.toLowerCase() === "pm" ? 12 : 0);
  let candidates;

  if (mon) {
    const month = MONTHS.indexOf(mon.toLowerCase());
    if (month < 0) throw new Error(`can't read the month in "${text}" from claude /usage`);
    const year = now.getUTCFullYear();

    candidates = [year - 1, year, year + 1].map((y) =>
      Date.UTC(y, month, Number(day), hour, Number(min)),
    );
  } else {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, +min);

    candidates = [today - DAY, today, today + DAY];
  }

  const closest = candidates.reduce((a, b) =>
    Math.abs(b - now.getTime()) < Math.abs(a - now.getTime()) ? b : a,
  );

  return new Date(closest);
}

/** The Usage for one window ("5h" or "week") in the text /usage printed. */
function parseUsage(text, kind, now) {
  const line = LINES[kind];
  const m = text.match(line.re);
  if (!m) throw new Error(`claude /usage printed no "${line.name}" line`);

  return { percent: Number(m[1]), resetsAt: m[2] ? parseReset(m[2], now) : null };
}

const ARGS = [
  "-p",
  "/usage",
  "--output-format",
  "json",
  "--no-session-persistence",
  "--strict-mcp-config",
  "--settings",
  '{"disableAllHooks":true}',
];

/** The text `claude -p /usage` prints. Rejects when claude is missing or reports an error. */
function runUsage() {
  return new Promise((resolve, reject) => {
    execFile(
      "claude",
      ARGS,
      { cwd: homedir(), env: { ...process.env, TZ: "UTC" }, timeout: 60_000 },
      (err, stdout, stderr) => {
        if (err?.code === "ENOENT") {
          return reject(new Error("claude (Claude Code) is not on your PATH"));
        }

        let out;

        try {
          out = JSON.parse(stdout);
        } catch {
          const why = String(stderr || err?.message || stdout)
            .trim()
            .split("\n")[0];

          return reject(new Error(`claude /usage failed: ${why || "no output"}`));
        }

        if (out.is_error || typeof out.result !== "string") {
          return reject(new Error(`claude /usage failed: ${out.result ?? "no result"}`));
        }

        resolve(out.result);
      },
    );
  });
}

/** The Usage for one window ("5h" or "week"), from running claude. `run` is for tests. */
async function readUsage(kind, now, run = runUsage) {
  return parseUsage(await run(), kind, now);
}

export { parseReset, parseUsage, readUsage };
