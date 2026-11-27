import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  costOf,
  groupWorkspaces,
  loadPath,
  makeProject,
  parseCosts,
  parseTranscriptUncached,
  projectLabel,
  tailLines,
  turnExtra,
  turnModel,
} from "../bin/dclaude.mjs";

const BIN = fileURLToPath(new URL("../bin/dclaude.mjs", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "dclaude-test-"));

after(() => rmSync(tmp, { recursive: true, force: true }));

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

/** Rates in dollars per token, as parseCosts returns them. */
const price = (input, output, write5m, write1h, read) => ({
  input,
  output,
  "5mPromptCacheWrite": write5m,
  "60mPromptCacheWrite": write1h,
  hitAndRefresh: read,
});

const call = (fields) => ({
  model: "m",
  input: 0,
  output: 0,
  new_input: 0,
  cache_write_5m: 0,
  cache_write_1h: 0,
  cache_read: 0,
  flags: [],
  ...fields,
});

describe("parseTranscriptUncached", () => {
  const path = transcript(join(tmp, "parse", "session.jsonl"), [
    { type: "custom-title", customTitle: "My session" },
    user("first prompt", "2026-11-27T01:00:00.000Z", { cwd: "/repos/app" }),
    assistant("m1", { ...USAGE, output_tokens: 10 }, "2026-11-27T01:00:01.000Z", {
      perTurnEffort: "high",
    }),
    // A later content block of the same response carries the final usage.
    assistant("m1", USAGE, "2026-11-27T01:00:02.000Z"),
    // A tool result is not a new prompt, so the next call stays in the first turn.
    user([{ type: "tool_result", content: "ok" }], "2026-11-27T01:00:03.000Z"),
    assistant("m2", USAGE, "2026-11-27T01:00:04.000Z"),
    user("second prompt", "2026-11-27T01:01:00.000Z"),
    assistant("m3", { ...USAGE, speed: "fast" }, "2026-11-27T01:01:01.000Z"),
  ]);
  const t = parseTranscriptUncached(path);

  test("reads the title and working directory", () => {
    assert.equal(t.title, "My session");
    assert.equal(t.cwd, "/repos/app");
  });

  test("starts a turn at each typed prompt, not at tool results", () => {
    assert.deepEqual(
      t.turns.map((turn) => [turn.prompt, turn.calls.length]),
      [
        ["first prompt", 2],
        ["second prompt", 1],
      ],
    );
  });

  test("counts each API response once, with its final usage", () => {
    const [first] = t.turns[0].calls;

    assert.equal(t.callCount, 3);
    assert.equal(first.output, 50);
    assert.equal(first.input, 1103);
    assert.equal(first.end, "2026-11-27T01:00:02.000Z");
    assert.equal(first.effort, "high");
    assert.equal(t.totals.output, 150);
  });

  test("records non-default modes as flags", () => {
    assert.deepEqual(t.turns[1].calls[0].flags, ["fast"]);
  });
});

const entry = (input) => ({
  input: { dollarCost: input, perTokens: 1_000_000 },
  output: { dollarCost: 25, perTokens: 1_000_000 },
  "5mPromptCacheWrite": { dollarCost: 6.25, perTokens: 1_000_000 },
  "60mPromptCacheWrite": { dollarCost: 10, perTokens: 1_000_000 },
  hitAndRefresh: { dollarCost: 0.5, perTokens: 1_000_000 },
});

describe("parseCosts", () => {
  test("turns prices into dollars per token and sorts tiers largest first", () => {
    const rates = parseCosts(
      JSON.stringify({
        m: {
          ...entry(5),
          overPromptTokens: { 1000: entry(7), 200000: entry(10) },
          multipliers: { batch: 0.5 },
        },
      }),
    );

    assert.equal(rates.m.base.input, 5 / 1_000_000);
    assert.deepEqual(
      rates.m.tiers.map((tier) => tier.over),
      [200000, 1000],
    );
    assert.deepEqual(rates.m.multipliers, { batch: 0.5 });
  });

  test("allows digit separators outside strings", () => {
    const text = JSON.stringify({ m: entry(5) }).replaceAll("1000000", "1_000_000");

    assert.equal(parseCosts(text).m.base.output, 25 / 1_000_000);
  });

  test("names the missing price", () => {
    const { hitAndRefresh: _, ...partial } = entry(5);

    assert.throws(() => parseCosts(JSON.stringify({ m: partial })), /m\.hitAndRefresh needs/);
  });

  test("rejects a negative multiplier", () => {
    const text = JSON.stringify({ m: { ...entry(5), multipliers: { fast: -1 } } });

    assert.throws(() => parseCosts(text), /m\.multipliers\.fast/);
  });
});

describe("costOf", () => {
  const rates = {
    m: {
      base: price(1, 10, 2, 3, 0.1),
      tiers: [{ over: 1000, rates: price(5, 50, 10, 15, 0.5) }],
      multipliers: { batch: 0.5 },
    },
  };

  test("prices every token kind", () => {
    const c = call({
      input: 111,
      output: 2,
      new_input: 1,
      cache_write_5m: 10,
      cache_write_1h: 0,
      cache_read: 100,
    });

    assert.equal(costOf([c], rates), 1 + 20 + 20 + 10);
  });

  test("uses the tier price when the whole prompt is over its size", () => {
    assert.equal(costOf([call({ input: 1001, new_input: 1 })], rates), 5);
  });

  test("applies multipliers for flags and ignores fallback", () => {
    const c = call({ input: 1, new_input: 1, flags: ["batch", "fallback"] });

    assert.equal(costOf([c], rates), 0.5);
  });

  test("is unknown for an unpriced flag or model", () => {
    assert.equal(costOf([call({ input: 1, flags: ["fast"] })], rates), null);
    assert.equal(costOf([call({ model: "other", input: 1 })], rates), null);
  });

  test("ignores an unknown model that used no tokens", () => {
    assert.equal(costOf([call({ model: "other" })], rates), 0);
  });
});

describe("turn summaries", () => {
  test("turnModel drops the claude- prefix and says multiple for mixed turns", () => {
    assert.equal(turnModel([call({ model: "claude-opus-5-5", input: 1 })]), "opus-5-5");
    assert.equal(
      turnModel([call({ model: "claude-a", input: 1 }), call({ model: "claude-b", input: 1 })]),
      "multiple",
    );
  });

  test("turnExtra joins efforts and flags", () => {
    assert.equal(turnExtra([call({ effort: "high", flags: ["fast"] })]), "high fast");
  });
});

const turn = (project, cost, ts) => ({ project, cost, ts });

describe("tailLines", () => {
  const turns = [
    turn("~/a", 1, "2026-11-27T03:00:00.000Z"),
    turn("~/a", 2, "2026-11-27T02:00:00.000Z"),
    turn("~/b", null, "2026-11-27T01:00:00.000Z"),
    turn("~/a", 4, "2026-11-27T00:00:00.000Z"),
  ];

  test("groups consecutive turns under a project line with its latest time and cost", () => {
    const lines = tailLines(turns, {}, 10);

    assert.deepEqual(
      lines.filter((l) => !l.turn),
      [
        { project: "~/a", latest: "2026-11-27T03:00:00.000Z", cost: 3 },
        { project: "~/b", latest: "2026-11-27T01:00:00.000Z", cost: null },
        { project: "~/a", latest: "2026-11-27T00:00:00.000Z", cost: 4 },
      ],
    );
  });

  test("never ends with a project line that has no turn under it", () => {
    const lines = tailLines(turns, {}, 4);

    assert.equal(lines.length, 3);
    assert.ok(lines.at(-1).turn);
  });

  test("has no cost without a price table", () => {
    assert.equal(tailLines(turns, null, 10)[0].cost, null);
  });
});

describe("projectLabel", () => {
  // Local time, so the expected strings match whatever time zone the tests run in.
  const latest = new Date(2026, 10, 27, 1, 23, 18).toISOString();
  const path = "~/repos/TrackEvents";
  const long = "~/repos/dclaude/.claude/worktrees/header-timestamp-cost";

  test("shows the full path and time when there is room", () => {
    assert.equal(projectLabel(path, latest, 80), `${path}  (latest 2026-11-27T01:23:18)`);
  });

  test("shrinks the time in stages as room runs out", () => {
    const at = (room) => projectLabel(path, latest, room);

    assert.equal(at(path.length + 29), `${path}  (2026-11-27T01:23:18)`);
    assert.equal(at(path.length + 12), `${path}  (01:23:18)`);
    assert.equal(at(path.length + 9), `${path}  (23:18)`);
    assert.equal(at(path.length + 8), path);
  });

  test("clips a long path before shrinking the time", () => {
    const label = projectLabel(long, latest, 60);

    assert.equal(label.length, 60);
    assert.ok(label.endsWith("…  (latest 2026-11-27T01:23:18)"));
  });

  test("keeps PATH_MIN characters of the path before dropping the time", () => {
    assert.equal(projectLabel(long, latest, 25), long.slice(0, 24) + "…");
  });
});

const project = (name, start) =>
  makeProject(name, `/dir/${name}`, [
    { start, end: start, turns: [], totals: {}, callCount: 1, subagents: [] },
  ]);

describe("groupWorkspaces", () => {
  test("merges Claude Code worktrees and Conductor workspaces into their project", () => {
    const merged = groupWorkspaces([
      project("/repos/app", "2026-11-01"),
      project("/repos/app/.claude/worktrees/fix-bug", "2026-11-02"),
      project("/c/conductor/workspaces/site/tokyo", "2026-11-03"),
      project("/c/conductor/workspaces/site/paris", "2026-11-04"),
      project("/repos/other", "2026-11-05"),
    ]);

    assert.deepEqual(
      merged.map((p) => [p.name, p.sessions.length]),
      [
        ["/c/conductor/workspaces/site", 2],
        ["/repos/app", 2],
        ["/repos/other", 1],
      ],
    );
  });
});

describe("loading a projects folder", () => {
  const root = join(tmp, "projects");
  const session = join(root, "-repos-app", "s1.jsonl");

  transcript(session, [
    user("main prompt", "2026-11-27T01:00:00.000Z", { cwd: "/repos/app" }),
    assistant("m1", USAGE, "2026-11-27T01:00:01.000Z"),
  ]);
  transcript(join(root, "-repos-app", "s1", "subagents", "agent-1.jsonl"), [
    user("subagent task", "2026-11-27T01:00:02.000Z", { isSidechain: true }),
    assistant("m2", USAGE, "2026-11-27T01:00:03.000Z", { isSidechain: true }),
  ]);
  // A project folder with no API calls is left out.
  transcript(join(root, "-repos-empty", "s2.jsonl"), [user("hi", "2026-11-27T01:00:00.000Z")]);

  test("names the project by its cwd and attaches subagents to their session", () => {
    const [p, ...rest] = loadPath(root);

    assert.equal(rest.length, 0);
    assert.equal(p.name, "/repos/app");
    assert.equal(p.callCount, 2);
    assert.equal(p.subagentCount, 1);
    assert.equal(p.sessions[0].subagents[0].turns[0].prompt, "subagent task");
  });

  test("the CLI writes a CSV row per API call", () => {
    const csv = execFileSync(process.execPath, [BIN, root, "--csv"], { encoding: "utf8" });
    const [header, ...rows] = csv.trim().split("\n");

    assert.match(header, /^project,/);
    assert.equal(rows.length, 2);
  });

  test("the CLI rejects an unknown option", () => {
    assert.throws(
      () => execFileSync(process.execPath, [BIN, "--nope"], { stdio: "pipe" }),
      (e) => e.status === 2 && String(e.stderr).includes("Unknown option: --nope"),
    );
  });
});
