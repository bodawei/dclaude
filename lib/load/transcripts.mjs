// LAYER 1: LOADING. Transcripts.
//
// Reads Claude Code's .jsonl transcripts from disk and decodes them into plain data: projects,
// sessions, subagents, turns and API calls. Decoding includes what the file format forces on
// us: one API response is written as several records, so calls are de-duplicated by message id
// here.
//
// This layer does not total, filter, merge or name anything (lib/transform/), and it never
// prints or exits (lib/present/, bin/). It imports nothing from the other layers.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Shapes returned by this file:
 *   RawProject    { dir, sessions: RawSession[] }
 *   RawSession    { path, title, cwd, turns: Turn[], subagents: RawSubagent[] }
 *   RawSubagent   { path, title, cwd, turns: Turn[], meta: {agentType?, description?} }
 *   Turn          { prompt, ts, last, calls: Call[] }   last: the newest record time in the turn
 *   Call          { model, effort, start, end, flags: string[], input, output, new_input,
 *                   cache_write, cache_read, thinking, cache_write_5m, cache_write_1h }
 */

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
    cache_write_5m: u.cache_creation
      ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0)
      : cache_write,
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

function readRecords(path) {
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip partial lines */
    }
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

/**
 * Parse one transcript into { path, title, cwd, turns }. Subagent transcripts mark every
 * record as a sidechain. Callers must not mutate the result: --tail reuses it from the cache.
 */
function parseTranscriptUncached(path, { subagent = false } = {}) {
  const records = readRecords(path);
  const requestTime = new Map(
    records.filter((r) => r.type === "api-request").map((r) => [r.id, r.timestamp]),
  );
  const turns = [];
  const seen = new Map();
  let current = null,
    title = null,
    cwd = null;
  for (const rec of records) {
    if (rec.type === "custom-title" && rec.customTitle) title = rec.customTitle;
    cwd ??= rec.cwd ?? null;
    const msg = rec.message ?? {};
    if (rec.type === "user" && !rec.isMeta && (subagent || !rec.isSidechain)) {
      const text = promptText(msg.content);
      if (text !== null)
        turns.push((current = { prompt: text, ts: rec.timestamp, last: null, calls: [] }));
    } else if (rec.type === "assistant" && msg.usage) {
      if (!current)
        turns.push((current = { prompt: "(no prompt)", ts: rec.timestamp, last: null, calls: [] }));
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
    // The turn's own work shows it is live: its prompt, responses, API requests and tool
    // results. Meta and system records (local slash commands between prompts) do not.
    const ts = typeof rec.timestamp === "string" ? rec.timestamp : null;
    const ownWork =
      rec.type === "assistant" ||
      rec.type === "api-request" ||
      (rec.type === "user" && !rec.isMeta);
    if (current && ts && ownWork && (subagent || !rec.isSidechain) && !(current.last >= ts)) {
      current.last = ts;
    }
  }
  return { path, title, cwd, turns };
}

const jsonlIn = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .toSorted()
    .map((f) => join(dir, f));

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** A session file plus the subagent transcripts in <session-id>/subagents/. */
function loadSession(file) {
  const subDir = join(file.replace(/\.jsonl$/, ""), "subagents");
  const subagents = existsSync(subDir)
    ? jsonlIn(subDir).map((f) =>
        // A copy: the parsed transcript is cached and must not be changed.
        Object.assign({}, parseTranscript(f, { subagent: true }), {
          meta: readJson(f.replace(/\.jsonl$/, ".meta.json")),
        }),
      )
    : [];
  return { ...parseTranscript(file), subagents };
}

/** Accepts the projects root, a single project folder, or a .jsonl file. */
function loadPath(p) {
  if (!statSync(p).isDirectory()) return [{ dir: p, sessions: [loadSession(p)] }];
  if (jsonlIn(p).length > 0) return [{ dir: p, sessions: jsonlIn(p).map(loadSession) }];
  return readdirSync(p)
    .toSorted()
    .map((d) => join(p, d))
    .filter((d) => statSync(d).isDirectory())
    .map((d) => ({ dir: d, sessions: jsonlIn(d).map(loadSession) }));
}

/** Every RawProject under the given paths, in order. */
const loadPaths = (paths) => paths.flatMap(loadPath);

export { loadPath, loadPaths, parseTranscriptUncached };
