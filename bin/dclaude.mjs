#!/usr/bin/env node
// dclaude: token usage report for Claude Code session transcripts. Run `dclaude --help`.
//
// The command line. It reads the options and runs the three layers in order:
//   1. lib/load/       read transcripts and the price file from disk
//   2. lib/transform/  totals, filtering, workspace merging, costs (no formatting)
//   3. lib/present/    Markdown (markdown.mjs), CSV (csv.mjs) or the live view (tail.mjs)
// It is also the only place that writes to stdout/stderr or sets the exit code.

import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { loadCosts } from "../lib/load/prices.mjs";
import { loadPaths } from "../lib/load/transcripts.mjs";
import { readUsage } from "../lib/load/usage.mjs";
import { tilde, windowText } from "../lib/present/common.mjs";
import { csvReport, csvSummary } from "../lib/present/csv.mjs";
import { markdownReport } from "../lib/present/markdown.mjs";
import { runTail } from "../lib/present/tail.mjs";
import { allTurns, buildProjects } from "../lib/transform/projects.mjs";
import { KINDS, windowOf } from "../lib/transform/windows.mjs";

const HELP = `dclaude: token usage report for Claude Code session transcripts (.jsonl).

Usage:
  dclaude [path ...] [options]

  path          ~/.claude/projects (the default), one project folder in it, or a .jsonl file

Options:
  --summary     only the per-project summary table
  --no-calls    one row per turn; hide the per-API-call rows
  --csv         CSV instead of Markdown: one row per API call (per turn with --no-calls,
                per project with --summary); times are ISO 8601 UTC
  --hide-worktrees
                merge workspace folders into their project: <project>/.claude/worktrees/<name>
                into <project>, and .../conductor/workspaces/<project>/<workspace> into
                .../conductor/workspaces/<project>
  --tail        full-screen view of the most recent turns (newest first), refreshed every
                second. Consecutive turns in the same project sit under a line naming
                the project (with its latest turn's time and their total COST); each
                turn line shows the model ("claude-" dropped, "multiple" if several),
                effort and flags when there is room, INPUT-NEW (new-input +
                cache_write), INPUT-CACHED (cache_read), OUTPUT and the start of the
                prompt (20+ chars).
                Subagent turns are marked "↳". A turn that wrote to its transcript in
                the last 10 seconds is shaded bright blue, in the last 60 dark blue.
                With --window, the header shows the window.
                Press q or Ctrl-C to quit.
                With a price table in ~/.dclaude_costs.json (or ~/dclaude_costs.json), a
                COST column shows each turn's cost in dollars: new-input, output, cache
                writes (priced by TTL) and cache_read combined. "?" means a model is missing
                from the table. The file name must end in ".json".
                Format, keyed by model name (example figures):
                  { "claude-opus-5-5": {
                      "input":               { "dollarCost": 5,    "perTokens": 1000000 },
                      "output":              { "dollarCost": 25,   "perTokens": 1000000 },
                      "5mPromptCacheWrite":  { "dollarCost": 6.25, "perTokens": 1000000 },
                      "60mPromptCacheWrite": { "dollarCost": 10,   "perTokens": 1000000 },
                      "hitAndRefresh":       { "dollarCost": 0.5,  "perTokens": 1000000 },
                      "overPromptTokens": { "200000": { <the same five prices> } },
                      "multipliers": { "batch": 0.5, "fast": 2, "us-inference": 1.1 } } }
                "overPromptTokens" is optional: it gives prices for calls whose prompt
                (new-input + cache_write + cache_read) is over that many tokens; the
                largest threshold below the prompt size wins.
                "multipliers" is optional: keyed by a name from the flags column, it
                scales every price of a call with that flag; several flags multiply.
                A call with a flag its model has no multiplier for shows "?".
  --window <5h|week|month>
                only the turns in one window, in every output: 5h (your plan's current
                5-hour session) or week (its current week, all models), both read from
                Claude Code's /usage, so \`claude\` must be on your PATH; or month (the
                current calendar month). A turn that started before the window is counted
                whole and marked "↤" (not in CSV). The Markdown report and the --tail
                header show the window: its start and end and, for 5h and week, the
                percentage used. --tail reads /usage again a minute after the window
                resets and every 15 minutes; if that fails, the header says "can't
                retrieve". Only this machine's transcripts are read, so use on other
                machines, on the web or in cloud sessions counts toward the percentage but
                is not listed.
  --help, -h    show this help
  --version, -v show the version

The Markdown report starts with a summary table (one row per project), then lists each
project's sessions (oldest first), each followed by the subagents it launched.

A "turn" starts at each prompt you type. Claude Code writes one record per content
block, all repeating the same usage, so API calls are de-duplicated by message id.

Columns:
  time            when the request was sent (local time in Markdown)
  secs            call: request sent -> last response block written
                  turn: first request sent -> last response written (includes tool runs)
  thinking-level  effort setting recorded for the call (low/medium/high/xhigh/max)
  flags           non-default modes, blank when none: batch / priority (service tier),
                  fast (fast mode), us-inference (inference_geo), fallback (refusal fallback)
  input           total prompt size = new-input + cache_write + cache_read
  output          output tokens (includes thinking)
  calls           API calls in the turn
  new-input       uncached input tokens after the last cache marker (usage.input_tokens)
  cache_write     input tokens written to the prompt cache (cache_creation_input_tokens)
  cache_read      input tokens served from the prompt cache (cache_read_input_tokens)
  thinking        thinking tokens (subset of output, when reported)`;

/**
 * The options as parseArgs() config, read from the Options section of HELP: every line there
 * that starts with two spaces and "--" names one option, its short form if any, and "<...>"
 * if it takes a value ("  --help, -h  ...", "  --window <5h|week|month>"). The help text is
 * the one list; test/cli.test.mjs checks that README.md lists the same options.
 */
function optionsIn(help) {
  const start = help.indexOf("\nOptions:\n");
  const section = help.slice(start, help.indexOf("\n\n", start + 1));

  return Object.fromEntries(
    [...section.matchAll(/^ {2}--([\w-]+)(?:, -(\w))?( <)?/gm)].map(([, name, short, value]) => [
      name,
      { type: value ? "string" : "boolean", ...(short ? { short } : {}) },
    ]),
  );
}

const OPTIONS = optionsIn(HELP);
const DEFAULT_ROOT = join(homedir(), ".claude", "projects");

/** The --window Window of `kind` now; for 5h and week, from running claude /usage. */
async function currentWindow(kind) {
  const now = new Date();

  return windowOf(kind, kind === "month" ? null : await readUsage(kind, now), now);
}

const REFRESH_MS = 15 * 60_000, // read /usage at least this often
  AFTER_RESET_MS = 60_000, // and this long after the window resets
  RETRY_MS = 2 * 60_000; // or this often while no window is open or reading fails

/**
 * Keep the --tail window current: read it again a minute after it ends, at least every 15
 * minutes, and every 2 minutes while none is open or reading fails. A failed read keeps the
 * last window's start for filtering and marks it with `error`. Returns a getter.
 */
function watchWindow(kind, first) {
  let current = first;
  const delay = () => {
    if (current.error || !current.end) return RETRY_MS;

    return Math.max(5_000, Math.min(REFRESH_MS, current.end - Date.now() + AFTER_RESET_MS));
  };
  const refresh = async () => {
    try {
      current = await currentWindow(kind);
    } catch {
      current = { ...current, error: true };
    }

    setTimeout(refresh, delay());
  };

  setTimeout(refresh, delay());

  return () => current;
}

async function main(argv) {
  let values, positionals;

  try {
    ({ values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true }));
  } catch (e) {
    // parseArgs's own message suggests "--" for a path starting with "-"; keep ours short.
    const unknown = e.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" && e.message.match(/'([^']*)'/);

    console.error(`dclaude: ${unknown ? `Unknown option: ${unknown[1]}` : e.message}\n\n${HELP}`);
    process.exit(2);
  }

  if (values.help) return console.log(HELP);
  if (values.version) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

    return console.log(pkg.version);
  }

  if (values.window !== undefined && !KINDS.includes(values.window)) {
    console.error(`dclaude: --window must be one of ${KINDS.join(", ")}, not "${values.window}"`);
    process.exit(2);
  }

  const paths = (positionals.length ? positionals : [DEFAULT_ROOT]).map((a) =>
    resolve(a.replace(/^~(?=$|\/)/, homedir())),
  );
  const opts = { hideWorktrees: Boolean(values["hide-worktrees"]) };
  let rates;
  try {
    rates = loadCosts();
  } catch (e) {
    console.error(`dclaude: ${tilde(e.path)}: ${e.message}`);
    process.exit(2);
  }
  let window = null;

  if (values.window) {
    try {
      window = await currentWindow(values.window);
    } catch (e) {
      console.error(`dclaude: --window ${values.window}: ${e.message}`);
      process.exit(1);
    }
  }

  const projects = (since) => buildProjects(loadPaths(paths), { ...opts, since });

  if (values.tail) {
    const getWindow = window ? watchWindow(values.window, window) : () => null;

    return runTail(() => allTurns(projects(getWindow()?.start ?? null), rates), rates, getWindow);
  }

  const loaded = projects(window?.start ?? null);

  if (loaded.length === 0) {
    console.error(
      window
        ? `No turns in this window (${windowText(window)}).`
        : "No transcripts with usage found.",
    );
    process.exit(1);
  }

  const showCalls = !values["no-calls"];
  const summaryOnly = Boolean(values.summary);

  if (values.csv) {
    process.stdout.write(summaryOnly ? csvSummary(loaded) : csvReport(loaded, showCalls));
  } else {
    process.stdout.write(markdownReport(loaded, { showCalls, summaryOnly, window }));
  }
}

// Run only as the command (npm's bin link is a symlink), not when a test imports this file.
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv.slice(2));
