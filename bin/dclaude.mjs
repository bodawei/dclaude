#!/usr/bin/env node
// dclaude: token usage report for Claude Code session transcripts. Run `dclaude --help`.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";


const HELP = `dclaude: token usage report for Claude Code session transcripts (.jsonl).

Usage:
  dclaude [path ...] [options]

  path          ~/.claude/projects (the default), one project folder in it, or a .jsonl file

Options:
  --summary     only the per-project summary table
  --no-calls    one row per turn; hide the per-API-call rows
  --csv         CSV instead of Markdown: one row per API call (per turn with --no-calls,
                per project with --summary); times are ISO 8601 UTC
  --conductor   merge .../conductor/workspaces/<project>/<workspace> folders into one
                project, .../conductor/workspaces/<project>
  --tail        full-screen view of the most recent turns (newest first), refreshed every
                second. Consecutive turns in the same project sit under a line naming
                the project (with their total COST); each turn line shows the model
                ("claude-" dropped, "multiple" if several), effort and flags when there
                is room, INPUT-NEW (new-input + cache_write), INPUT-CACHED (cache_read),
                OUTPUT and the start of the prompt (20+ chars).
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

const KNOWN_FLAGS = new Set(["--summary", "--no-calls", "--csv", "--conductor", "--tail", "--help", "-h", "--version", "-v"]);
const FIELDS = ["input", "output", "new_input", "cache_write", "cache_read", "thinking"];
const DEFAULT_ROOT = join(homedir(), ".claude", "projects");

// ---------- parsing ----------

function promptText(content) {
  if (typeof content === "string") return content;
  const texts = [];
  let hasToolResult = false;
  for (const b of content ?? []) {
    if (b.type === "tool_result") hasToolResult = true;
    else if (b.type === "text") texts.push(b.text ?? "");
  }
  return hasToolResult && texts.length === 0 ? null : texts.join(" ");
}

function usageOf(u) {
  const new_input = u.input_tokens ?? 0;
  const cache_write = u.cache_creation_input_tokens ?? 0;
  const cache_read = u.cache_read_input_tokens ?? 0;
  return {
    input: new_input + cache_write + cache_read,
    output: u.output_tokens ?? 0,
    new_input,
    cache_write,
    cache_read,
    thinking: u.output_tokens_details?.thinking_tokens ?? 0,
    // Split of cache_write by TTL; without the breakdown, the API default (5m) applies.
    cache_write_5m: u.cache_creation ? u.cache_creation.ephemeral_5m_input_tokens ?? 0 : cache_write,
    cache_write_1h: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  };
}

/**
 * Non-default billing/routing modes reported in usage:
 *   service_tier other than "standard" -> "batch", "priority", ...
 *   speed "fast"                       -> "fast"
 *   inference_geo other than "global"  -> "<geo>-inference", e.g. "us-inference"
 *   a fallback_message iteration       -> "fallback" (request re-run on a fallback model)
 */
function flagsOf(u) {
  const flags = [];
  if (u.service_tier && u.service_tier !== "standard") flags.push(u.service_tier);
  if (u.speed === "fast") flags.push("fast");
  if (u.inference_geo && !["global", "not_available"].includes(u.inference_geo)) {
    flags.push(`${u.inference_geo}-inference`);
  }
  if ((u.iterations ?? []).some((it) => it.type === "fallback_message")) flags.push("fallback");
  return flags;
}

/** Union of the calls' flags, in first-seen order. */
const turnFlags = (calls) => [...new Set(calls.flatMap((c) => c.flags))].join(", ");

function readRecords(path) {
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip partial lines */ }
  }
  return out;
}

/** Parsed transcripts keyed by path; reparsed only when size or mtime changes (for --tail). */
const parseCache = new Map();

function parseTranscript(path, opts = {}) {
  const st = statSync(path);
  const hit = parseCache.get(path);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.result;
  const result = parseTranscriptUncached(path, opts);
  parseCache.set(path, { size: st.size, mtimeMs: st.mtimeMs, result });
  return result;
}

/** Parse one transcript. Subagent transcripts mark every record as a sidechain. */
function parseTranscriptUncached(path, { subagent = false } = {}) {
  const records = readRecords(path);
  const requestTime = new Map(
    records.filter((r) => r.type === "api-request").map((r) => [r.id, r.timestamp]),
  );
  const turns = [];
  const seen = new Map();
  let current = null, title = null, cwd = null;
  for (const rec of records) {
    if (rec.type === "custom-title" && rec.customTitle) title = rec.customTitle;
    cwd ??= rec.cwd ?? null;
    const msg = rec.message ?? {};
    if (rec.type === "user" && !rec.isMeta && (subagent || !rec.isSidechain)) {
      const text = promptText(msg.content);
      if (text !== null) turns.push((current = { prompt: text, ts: rec.timestamp, calls: [] }));
    } else if (rec.type === "assistant" && msg.usage) {
      if (!current) turns.push((current = { prompt: "(no prompt)", ts: rec.timestamp, calls: [] }));
      const id = msg.id ?? rec.requestId ?? rec.uuid;
      const call = seen.get(id);
      if (call) {
        Object.assign(call, usageOf(msg.usage), { flags: flagsOf(msg.usage) }); // later blocks may carry final usage
        call.end = rec.timestamp;
      } else {
        const c = {
          model: msg.model ?? "?",
          effort: rec.perTurnEffort ?? rec.effort ?? "—",
          start: requestTime.get(rec.requestRef) ?? rec.timestamp,
          end: rec.timestamp,
          ...usageOf(msg.usage),
          flags: flagsOf(msg.usage),
        };
        seen.set(id, c);
        current.calls.push(c);
      }
    }
  }
  const calls = turns.flatMap((t) => t.calls);
  return {
    path, title, cwd, turns,
    start: calls[0]?.start ?? null,
    end: calls.at(-1)?.end ?? null,
    totals: sum(calls),
    callCount: calls.length,
  };
}

function sum(items) {
  const t = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  for (const it of items) for (const f of FIELDS) t[f] += it[f] ?? 0;
  return t;
}

// ---------- costs ----------

const COST_FILES = [".dclaude_costs", "dclaude_costs"].map((f) => join(homedir(), f));
const COST_KEYS = ["input", "output", "5mPromptCacheWrite", "60mPromptCacheWrite", "hitAndRefresh"];

/**
 * The price table from ~/.dclaude_costs (or ~/dclaude_costs), or null if neither exists:
 *   { "<model>": { "input": { "dollarCost": 5, "perTokens": 1000000 }, "output": {...},
 *                  "5mPromptCacheWrite": {...}, "60mPromptCacheWrite": {...}, "hitAndRefresh": {...},
 *                  "overPromptTokens": { "100000": { <the same five prices> } },
 *                  "multipliers": { "batch": 0.5, "fast": 2, "us-inference": 1.1 } } }
 * "overPromptTokens" is optional: prices for calls whose prompt (new-input + cache_write +
 * cache_read) is over the given size. "multipliers" is optional too: keyed by the names the
 * flags column uses, each scales every price of a call that has that flag. Numbers, and the
 * overPromptTokens keys, may use digit separators (1_000_000). Returns
 * { model: { base: rates, tiers: [{ over, rates }] (largest first), multipliers } },
 * where rates are { key: dollars per token }.
 */
function loadCosts() {
  const path = COST_FILES.find((p) => existsSync(p));
  if (!path) return null;
  const fail = (why) => {
    console.error(`dclaude: ${tilde(path)}: ${why}`);
    process.exit(2);
  };
  let table;
  try {
    // Drop "_" between digits outside strings, so 1_000_000 parses.
    const text = readFileSync(path, "utf8").replace(/("(?:[^"\\]|\\.)*")|(?<=\d)_(?=\d)/g, (m, s) => s ?? "");
    table = JSON.parse(text);
  } catch (e) {
    fail(e.message);
  }
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  if (!isObj(table)) fail("expected an object keyed by model name");
  const pricesOf = (entry, where) => {
    const r = {};
    for (const k of COST_KEYS) {
      const { dollarCost, perTokens } = entry?.[k] ?? {};
      if (typeof dollarCost !== "number" || typeof perTokens !== "number" || perTokens <= 0) {
        fail(`${where}.${k} needs numeric dollarCost and positive perTokens`);
      }
      r[k] = dollarCost / perTokens;
    }
    return r;
  };
  const rates = {};
  for (const [model, entry] of Object.entries(table)) {
    const over = entry?.overPromptTokens ?? {};
    if (!isObj(over)) fail(`${model}.overPromptTokens must be an object keyed by prompt size`);
    const tiers = Object.entries(over).map(([size, prices]) => {
      const n = Number(size.replaceAll("_", ""));
      if (!Number.isInteger(n) || n < 0) fail(`${model}.overPromptTokens: "${size}" is not a token count`);
      return { over: n, rates: pricesOf(prices, `${model}.overPromptTokens.${size}`) };
    });
    const multipliers = entry?.multipliers ?? {};
    if (!isObj(multipliers)) fail(`${model}.multipliers must be an object keyed by flag name`);
    for (const [flag, x] of Object.entries(multipliers)) {
      if (typeof x !== "number" || x < 0) fail(`${model}.multipliers.${flag} must be a non-negative number`);
    }
    rates[model] = { base: pricesOf(entry, model), tiers: tiers.sort((a, b) => b.over - a.over), multipliers };
  }
  return rates;
}

/** Flags that don't change the price of a call. */
const UNPRICED_FLAGS = new Set(["fallback"]);

/**
 * Dollar cost of some calls, or null when a call with tokens uses a model missing from the
 * table, or has a flag (batch, fast, us-inference, ...) its model gives no multiplier for.
 */
function costOf(calls, rates) {
  let total = 0;
  for (const call of calls) {
    const m = rates[call.model];
    if (!m) {
      if (call.input + call.output > 0) return null;
      continue;
    }
    // Priced per call by its whole prompt: call.input = new-input + cache_write + cache_read.
    const r = m.tiers.find((t) => call.input > t.over)?.rates ?? m.base;
    let x = 1;
    for (const f of call.flags) {
      if (UNPRICED_FLAGS.has(f)) continue;
      if (!(f in m.multipliers)) return null;
      x *= m.multipliers[f];
    }
    total += x * (call.new_input * r.input + call.output * r.output
      + call.cache_write_5m * r["5mPromptCacheWrite"] + call.cache_write_1h * r["60mPromptCacheWrite"]
      + call.cache_read * r.hitAndRefresh);
  }
  return total;
}

// ---------- discovery ----------

const jsonlIn = (dir) =>
  readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().map((f) => join(dir, f));

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; }
}

/** A session file plus the subagent transcripts in <session-id>/subagents/. */
function loadSession(file) {
  const session = parseTranscript(file);
  const subDir = join(file.replace(/\.jsonl$/, ""), "subagents");
  session.subagents = existsSync(subDir)
    ? jsonlIn(subDir).map((f) => ({
        ...parseTranscript(f, { subagent: true }),
        meta: readJson(f.replace(/\.jsonl$/, ".meta.json")),
      })).filter((s) => s.callCount > 0)
    : [];
  return session;
}

function loadProject(dir) {
  const sessions = jsonlIn(dir).map(loadSession)
    .filter((s) => s.callCount > 0 || s.subagents.length > 0);
  return makeProject(sessions.find((s) => s.cwd)?.cwd ?? basename(dir), dir, sessions);
}

/** Build a project record (with totals) from its sessions. */
function makeProject(name, dir, sessions) {
  sessions = [...sessions].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  const all = sessions.flatMap((s) => [s, ...s.subagents]);
  const starts = all.map((s) => s.start).filter(Boolean).sort();
  const ends = all.map((s) => s.end).filter(Boolean).sort();
  return {
    dir,
    name,
    sessions,
    start: starts[0] ?? null,
    end: ends.at(-1) ?? null,
    totals: sum(all.map((s) => s.totals)),
    turnCount: all.reduce((n, s) => n + s.turns.length, 0),
    callCount: all.reduce((n, s) => n + s.callCount, 0),
    subagentCount: sessions.reduce((n, s) => n + s.subagents.length, 0),
  };
}

/** Accepts the projects root, a single project folder, or a .jsonl file. */
function loadPath(p) {
  if (!statSync(p).isDirectory()) {
    const s = loadSession(p);
    return [makeProject(s.cwd ?? basename(p), p, [s])];
  }
  if (jsonlIn(p).length > 0) return [loadProject(p)];
  return readdirSync(p).sort()
    .map((d) => join(p, d))
    .filter((d) => statSync(d).isDirectory())
    .map(loadProject)
    .filter((proj) => proj.sessions.length > 0);
}

// ---------- formatting ----------

const pad = (n) => String(n).padStart(2, "0");
function fmtTime(iso, withTime = true) {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : date;
}
const secs = (a, b) => (a && b ? ((new Date(b) - new Date(a)) / 1000).toFixed(1) : "—");
const fmt = (n) => n.toLocaleString("en-US");
const clean = (s, n = 100) => {
  s = s.split(/\s+/).join(" ").trim().replaceAll("|", "\\|");
  return s.length > n ? s.slice(0, n) + "…" : s;
};
const joined = (calls, key) => [...new Set(calls.map((c) => c[key]))].sort().join(", ") || "—";
const row = (cells) => console.log("| " + cells.join(" | ") + " |");
const bold = (x) => `**${x}**`;
const nums = (d, b = false) => {
  const v = FIELDS.map((f) => (b ? bold(fmt(d[f])) : fmt(d[f])));
  return { io: v.slice(0, 2), rest: v.slice(2) };
};

function printSummary(projects) {
  console.log("## Summary by project\n");
  row(["project", "first", "last", "sessions", "subagents", "turns", "calls", "input", "output",
    "new-input", "cache_write", "cache_read", "thinking"]);
  console.log("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  const sorted = [...projects].sort((a, b) => (b.end ?? "").localeCompare(a.end ?? ""));
  for (const p of sorted) {
    const { io, rest } = nums(p.totals);
    row([clean(p.name, 80), fmtTime(p.start, false), fmtTime(p.end, false), p.sessions.length,
      p.subagentCount, p.turnCount, p.callCount, ...io, ...rest]);
  }
  const g = sum(projects.map((p) => p.totals));
  const { io, rest } = nums(g, true);
  const n = (k) => bold(projects.reduce((s, p) => s + p[k], 0));
  row([bold("total"), "", "", bold(projects.reduce((s, p) => s + p.sessions.length, 0)),
    n("subagentCount"), n("turnCount"), n("callCount"), ...io, ...rest]);
  console.log();
}

function printTranscript(t, showCalls) {
  row(["turn", "time", "secs", "model", "thinking-level", "flags", "input", "output", "calls",
    "new-input", "cache_write", "cache_read", "thinking", "first 100 input chars"]);
  console.log("|---|---|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|");
  t.turns.forEach((turn, i) => {
    if (turn.calls.length === 0) return;
    const first = turn.calls[0], last = turn.calls.at(-1);
    const { io, rest } = nums(sum(turn.calls));
    row([bold(i + 1), fmtTime(first.start), secs(first.start, last.end), joined(turn.calls, "model"),
      joined(turn.calls, "effort"), turnFlags(turn.calls), ...io, turn.calls.length, ...rest,
      clean(turn.prompt)]);
    if (showCalls && turn.calls.length > 1) {
      turn.calls.forEach((c, j) => {
        const n = nums(c);
        row([`${i + 1}.${j + 1}`, fmtTime(c.start), secs(c.start, c.end), c.model, c.effort,
          c.flags.join(", "), ...n.io, "", ...n.rest, ""]);
      });
    }
  });
  const { io, rest } = nums(t.totals, true);
  row([bold("total"), "", "", "", "", "", ...io, t.callCount, ...rest, ""]);
  console.log();
}

function printProject(p, showCalls) {
  console.log(`## ${p.name}\n`);
  for (const s of p.sessions) {
    const ws = workspaceOf(s);
    console.log(`### ${s.title ? clean(s.title) + " — " : ""}${fmtTime(s.start)}\n`);
    console.log(`Session ID: \`${basename(s.path, ".jsonl")}\`${ws ? ` · Workspace: \`${ws}\`` : ""}\n`);
    if (s.callCount > 0) printTranscript(s, showCalls);
    for (const sub of s.subagents) {
      const what = [sub.meta.agentType, sub.meta.description].filter(Boolean).join(": ");
      console.log(`#### ↳ subagent${what ? " — " + clean(what) : ""}\n`);
      console.log(`Agent ID: \`${basename(sub.path, ".jsonl").replace(/^agent-/, "")}\`\n`);
      printTranscript(sub, showCalls);
    }
  }
}

// ---------- CSV ----------

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const csvRow = (cells) => console.log(cells.map(csvCell).join(","));
const tokenCols = ["input", "output", "new_input", "cache_write", "cache_read", "thinking"];
const tokens = (d) => FIELDS.map((f) => d[f]);
const secsNum = (a, b) => (a && b ? ((new Date(b) - new Date(a)) / 1000).toFixed(1) : "");

/** One row per project (--summary). Times are ISO 8601 UTC. */
function printSummaryCsv(projects) {
  csvRow(["project", "first", "last", "sessions", "subagents", "turns", "calls", ...tokenCols]);
  for (const p of projects) {
    csvRow([p.name, p.start, p.end, p.sessions.length, p.subagentCount, p.turnCount, p.callCount,
      ...tokens(p.totals)]);
  }
}

/** One row per API call, or per turn with --no-calls. Times are ISO 8601 UTC. */
function printCsv(projects, showCalls) {
  csvRow(["project", "workspace", "session_id", "session_title", "agent_id", "agent_type",
    "agent_description", "turn", showCalls ? "call" : "calls", "time", "secs", "model",
    "thinking_level", "flags", ...tokenCols, "prompt"]);
  for (const p of projects) {
    for (const s of p.sessions) {
      for (const t of [s, ...s.subagents]) {
        const sub = t !== s;
        const ctx = [p.name, workspaceOf(s) ?? "", basename(s.path, ".jsonl"), s.title ?? "",
          sub ? basename(t.path, ".jsonl").replace(/^agent-/, "") : "",
          sub ? t.meta.agentType ?? "" : "", sub ? t.meta.description ?? "" : ""];
        t.turns.forEach((turn, i) => {
          if (turn.calls.length === 0) return;
          const prompt = clean(turn.prompt).replaceAll("\\|", "|");
          if (showCalls) {
            turn.calls.forEach((c, j) => csvRow([...ctx, i + 1, j + 1, c.start, secsNum(c.start, c.end),
              c.model, c.effort, c.flags.join(", "), ...tokens(c), prompt]));
          } else {
            const first = turn.calls[0], last = turn.calls.at(-1);
            csvRow([...ctx, i + 1, turn.calls.length, first.start, secsNum(first.start, last.end),
              joined(turn.calls, "model"), joined(turn.calls, "effort"), turnFlags(turn.calls),
              ...tokens(sum(turn.calls)), prompt]);
          }
        });
      }
    }
  }
}

// ---------- tail mode ----------

const home = homedir();
const tilde = (p) => (p.startsWith(home) ? "~" + p.slice(home.length) : p);
const fit = (s, w) => (w <= 0 ? "" : s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w));

/** "claude-opus-5-5" -> "opus-5-5"; a turn that used several models -> "multiple". */
function turnModel(calls) {
  const used = calls.filter((c) => c.input + c.output > 0);
  const models = [...new Set((used.length ? used : calls).map((c) => c.model.replace(/^claude-/, "")))];
  return models.length > 1 ? "multiple" : models[0] ?? "-";
}

/** Effort level(s) and flags of a turn, e.g. "high fast" (the least important --tail info). */
function turnExtra(calls) {
  if (calls.length === 0) return "-";
  const efforts = [...new Set(calls.map((c) => c.effort).filter((e) => e && e !== "—"))];
  return [efforts.join("/"), turnFlags(calls).replaceAll(", ", " ")].filter(Boolean).join(" ");
}

/** Every turn across all transcripts (subagent turns included), newest first. */
function recentTurns(projects, rates) {
  const out = [];
  for (const p of projects) {
    for (const s of p.sessions) {
      for (const t of [s, ...s.subagents]) {
        const sub = t !== s;
        for (const turn of t.turns) {
          const tot = sum(turn.calls);
          out.push({
            project: tilde(p.name),
            ts: turn.calls[0]?.start ?? turn.ts ?? "",
            model: (sub ? "↳ " : "") + turnModel(turn.calls),
            extra: turnExtra(turn.calls),
            inputNew: tot.new_input + tot.cache_write,
            inputCached: tot.cache_read,
            output: tot.output,
            prompt: turn.prompt.split(/\s+/).join(" ").trim(),
            cost: rates ? costOf(turn.calls, rates) : null,
          });
        }
      }
    }
  }
  return out.sort((a, b) => b.ts.localeCompare(a.ts));
}

const dollars = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (c) => (c == null ? "?" : "$" + dollars(c));

/**
 * The lines below the column headings: a project line each time the project changes (with
 * the cost of that run of turns), then one indented line per turn. At most `max` lines, and
 * never a project line with no turn under it.
 */
function tailLines(turns, rates, max) {
  const lines = [];
  for (let i = 0; i < turns.length && lines.length < max; ) {
    let j = i;
    while (j < turns.length && turns[j].project === turns[i].project) j++;
    const run = turns.slice(i, j), costs = run.map((t) => t.cost);
    const cost = rates ? (costs.includes(null) ? null : costs.reduce((a, b) => a + b, 0)) : null;
    if (lines.length + 1 >= max) break;
    lines.push({ project: run[0].project, cost });
    for (const t of run) {
      if (lines.length >= max) break;
      lines.push({ turn: t });
    }
    i = j;
  }
  return lines;
}

function tail(paths, opts, rates) {
  const out = process.stdout;
  const PROMPT_W = 20, GAP = " ", INDENT = "    ";
  const HEADS = ["PROJECT / MODEL", "INPUT-NEW", "INPUT-CACHED", "OUTPUT", "PROMPT", ...(rates ? ["COST"] : [])];
  const render = () => {
    // Stay off the last column: after a character there, the "\x1b[K" below erases it in
    // some terminals (e.g. macOS Terminal).
    const rows = out.rows || 24, cols = (out.columns || 80) - 1;
    const turns = recentTurns(loadAll(paths, opts), rates);
    const body = tailLines(turns, rates, Math.max(0, rows - 2));
    const shown = body.filter((l) => l.turn).map((l) => l.turn);
    const cells = shown.map((t) => [INDENT + t.model, fmt(t.inputNew), fmt(t.inputCached), fmt(t.output), t.prompt,
      ...(rates ? [money(t.cost)] : [])]);
    const groupCosts = body.filter((l) => !l.turn).map((l) => money(l.cost));
    // Number columns are as wide as their widest value or header.
    const w = HEADS.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
    if (rates) w[5] = Math.max(w[5], ...groupCosts.map((c) => c.length));
    const fixed = w[1] + w[2] + w[3] + (rates ? w[5] + GAP.length : 0) + 4 * GAP.length;
    // The rest is split between the first column (model, then effort/flags) and the prompt.
    // On a narrow screen, give up the effort/flags first, then the prompt, then the model
    // (down to 1), rather than let the right edge clip the cost.
    const extraW = Math.max(0, ...shown.map((t) => (t.extra ? t.extra.length + 1 : 0)));
    const room = cols - fixed;
    const modelW = Math.max(1, Math.min(w[0], room));
    const promptW = Math.max(0, Math.min(PROMPT_W, room - modelW));
    const firstW = modelW + Math.max(0, Math.min(extraW, room - modelW - promptW));
    const lastW = Math.max(promptW, room - firstW); // a wide screen shows more of the prompt
    const line = (c) =>
      [fit(c[0], firstW), c[1].padStart(w[1]), c[2].padStart(w[2]), c[3].padStart(w[3]),
        rates ? fit(c[4], lastW) : fit(c[4], lastW).trimEnd(),
        ...(rates ? [c[5].padStart(w[5])] : [])].join(GAP).trimEnd().slice(0, cols);
    const first = (t) => {
      const m = INDENT + t.model;
      return t.extra && firstW > m.length ? fit(m.padEnd(w[0]) + " " + t.extra, firstW) : m;
    };
    const turnLine = (t) => line([first(t), fmt(t.inputNew), fmt(t.inputCached), fmt(t.output), t.prompt,
      ...(rates ? [money(t.cost)] : [])]);
    // A project line: the path across the row, and the run's total under COST.
    const projectLine = (l) => {
      const costCell = rates ? GAP + money(l.cost).padStart(w[5]) : "";
      const text = rates ? fit(l.project, cols - costCell.length) + costCell : fit(l.project, cols).trimEnd();
      return "\x1b[1m" + text.slice(0, cols) + "\x1b[0m";
    };
    const now = new Date();
    const lines = [
      fit(`Claude Code usage · ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
        ` · ${turns.length} turns · q to quit`, cols),
      "\x1b[7m" + fit(line(HEADS), cols) + "\x1b[0m",
      ...body.map((l) => (l.turn ? turnLine(l.turn) : projectLine(l))),
    ];
    out.write("\x1b[H" + lines.map((l) => l + "\x1b[K").join("\n") + "\x1b[J");
  };
  const quit = () => {
    out.write("\x1b[?25h\x1b[?1049l"); // show cursor, leave alternate screen
    process.exit(0);
  };
  out.write("\x1b[?1049h\x1b[?25l"); // alternate screen, hide cursor
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (k) => {
      const key = k.toString();
      if (key === "q" || key === "\x03") quit(); // q or Ctrl-C (raw mode swallows SIGINT)
    });
  }
  // Terminals rewrap the old frame when the window changes size; wipe it before redrawing.
  out.on("resize", () => { out.write("\x1b[2J"); render(); });
  render();
  setInterval(render, 1000);
}

// ---------- main ----------

const CONDUCTOR_RE = /^(.*\/conductor\/workspaces\/[^/]+)\/([^/]+)/;

/** Merge .../conductor/workspaces/<project>/<workspace> folders into one project each. */
function groupConductor(projects) {
  const out = [], groups = new Map();
  for (const p of projects) {
    const m = p.name.match(CONDUCTOR_RE);
    if (!m) { out.push(p); continue; }
    if (!groups.has(m[1])) groups.set(m[1], []);
    groups.get(m[1]).push(p);
  }
  for (const [name, members] of groups) {
    out.push(makeProject(name, members.map((p) => p.dir).join(", "), members.flatMap((p) => p.sessions)));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Workspace name of a session inside a conductor workspace, else null. */
const workspaceOf = (s) => s.cwd?.match(CONDUCTOR_RE)?.[2] ?? null;

function loadAll(paths, { conductor = false } = {}) {
  let projects = paths.flatMap(loadPath);
  if (conductor) projects = groupConductor(projects);
  // Two folders can record the same cwd (e.g. a copied or renamed project folder).
  const counts = Map.groupBy(projects, (p) => p.name);
  for (const p of projects) {
    if (counts.get(p.name).length > 1) p.name += ` (${basename(p.dir)})`;
  }
  return projects;
}

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
  const paths = (args.length ? args : [DEFAULT_ROOT])
    .map((a) => resolve(a.replace(/^~(?=$|\/)/, homedir())));
  const opts = { conductor: flags.has("--conductor") };
  const rates = loadCosts();
  if (flags.has("--tail")) return tail(paths, opts, rates);
  const projects = loadAll(paths, opts);
  if (projects.length === 0) {
    console.error("No transcripts with usage found.");
    process.exit(1);
  }
  const showCalls = !flags.has("--no-calls");
  if (flags.has("--csv")) {
    return flags.has("--summary") ? printSummaryCsv(projects) : printCsv(projects, showCalls);
  }
  console.log(`# Claude Code usage report\n`);
  console.log(`${projects.length} project(s) · generated ${fmtTime(new Date().toISOString())}\n`);
  printSummary(projects);
  if (flags.has("--summary")) return;
  for (const p of projects) printProject(p, showCalls);
}

main(process.argv.slice(2));
