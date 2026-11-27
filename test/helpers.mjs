// Fixtures shared by the test files: transcript records, a temporary projects folder, and
// call objects shaped like the loading layer's.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

/** A fresh temporary directory, removed when the test file finishes. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "dclaude-test-"));

  after(() => rmSync(dir, { recursive: true, force: true }));

  return dir;
}

/** Write records as a .jsonl transcript and return its path. */
function transcript(path, records) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");

  return path;
}

const user = (text, timestamp, extra = {}) => ({
  type: "user",
  message: { content: text },
  timestamp,
  ...extra,
});

const assistant = (id, usage, timestamp, extra = {}) => ({
  type: "assistant",
  message: { id, model: "claude-opus-5-5", usage },
  timestamp,
  ...extra,
});

const USAGE = {
  input_tokens: 3,
  cache_creation_input_tokens: 100,
  cache_read_input_tokens: 1000,
  output_tokens: 50,
};

/**
 * A projects folder with one project (/repos/app: one session, one subagent, one call each)
 * and one project whose only session made no API calls.
 */
function projectsFolder() {
  const root = join(tempDir(), "projects");

  transcript(join(root, "-repos-app", "s1.jsonl"), [
    user("main prompt", "2026-11-27T01:00:00.000Z", { cwd: "/repos/app" }),
    assistant("m1", USAGE, "2026-11-27T01:00:01.000Z"),
  ]);
  transcript(join(root, "-repos-app", "s1", "subagents", "agent-1.jsonl"), [
    user("subagent task", "2026-11-27T01:00:02.000Z", { isSidechain: true }),
    assistant("m2", USAGE, "2026-11-27T01:00:03.000Z", { isSidechain: true }),
  ]);
  transcript(join(root, "-repos-empty", "s2.jsonl"), [user("hi", "2026-11-27T01:00:00.000Z")]);

  return root;
}

/** A call as lib/load/transcripts.mjs returns it, with every count zero unless given. */
const call = (fields) => ({
  model: "m",
  effort: "—",
  start: null,
  end: null,
  input: 0,
  output: 0,
  new_input: 0,
  cache_write: 0,
  cache_read: 0,
  thinking: 0,
  cache_write_5m: 0,
  cache_write_1h: 0,
  flags: [],
  ...fields,
});

export { assistant, call, projectsFolder, tempDir, transcript, USAGE, user };
