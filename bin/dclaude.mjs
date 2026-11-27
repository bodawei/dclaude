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

import { loadCosts } from "../lib/load/prices.mjs";
import { loadPaths } from "../lib/load/transcripts.mjs";
import { tilde } from "../lib/present/common.mjs";
import { csvReport, csvSummary } from "../lib/present/csv.mjs";
import { markdownReport } from "../lib/present/markdown.mjs";
import { runTail } from "../lib/present/tail.mjs";
import { allTurns, buildProjects } from "../lib/transform/projects.mjs";

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
                Subagent turns are marked "↳". Press q or Ctrl-C to quit.
                With a price table in ~/.dclaude_costs (or ~/dclaude_costs), a COST column
                shows each turn's cost in dollars: new-input, output, cache writes (priced
                by TTL) and cache_read combined. "?" means a model is missing from the table.
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

const KNOWN_FLAGS = new Set([
  "--summary",
  "--no-calls",
  "--csv",
  "--hide-worktrees",
  "--tail",
  "--help",
  "-h",
  "--version",
  "-v",
]);
const DEFAULT_ROOT = join(homedir(), ".claude", "projects");

function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("-")));
  const args = argv.filter((a) => !a.startsWith("-"));
  if (flags.has("--help") || flags.has("-h")) return console.log(HELP);
  if (flags.has("--version") || flags.has("-v")) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return console.log(pkg.version);
  }
  const unknown = [...flags].filter((f) => !KNOWN_FLAGS.has(f));
  if (unknown.length) {
    console.error(`Unknown option: ${unknown.join(", ")}\n\n${HELP}`);
    process.exit(2);
  }
  const paths = (args.length ? args : [DEFAULT_ROOT]).map((a) =>
    resolve(a.replace(/^~(?=$|\/)/, homedir())),
  );
  const opts = { hideWorktrees: flags.has("--hide-worktrees") };
  let rates;
  try {
    rates = loadCosts();
  } catch (e) {
    console.error(`dclaude: ${tilde(e.path)}: ${e.message}`);
    process.exit(2);
  }
  const projects = () => buildProjects(loadPaths(paths), opts);
  if (flags.has("--tail")) return runTail(() => allTurns(projects(), rates), rates);
  const loaded = projects();
  if (loaded.length === 0) {
    console.error("No transcripts with usage found.");
    process.exit(1);
  }
  const showCalls = !flags.has("--no-calls");
  const summaryOnly = flags.has("--summary");
  if (flags.has("--csv")) {
    process.stdout.write(summaryOnly ? csvSummary(loaded) : csvReport(loaded, showCalls));
  } else {
    process.stdout.write(markdownReport(loaded, { showCalls, summaryOnly }));
  }
}

// Run only as the command (npm's bin link is a symlink), not when a test imports this file.
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv.slice(2));
