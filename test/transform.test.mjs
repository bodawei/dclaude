// Layer 2, transformation: lib/transform/projects.mjs, costs.mjs and windows.mjs.

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";

import { loadPaths } from "../lib/load/transcripts.mjs";
import { costOf, sumCosts } from "../lib/transform/costs.mjs";
import {
  allTurns,
  buildProjects,
  groupWorkspaces,
  makeProject,
} from "../lib/transform/projects.mjs";
import { windowOf } from "../lib/transform/windows.mjs";
import { assistant, call, projectsFolder, tempDir, transcript, USAGE, user } from "./helpers.mjs";

/** Rates in dollars per token, as parseCosts returns them. */
const price = (input, output, write5m, write1h, read) => ({
  input,
  output,
  "5mPromptCacheWrite": write5m,
  "60mPromptCacheWrite": write1h,
  hitAndRefresh: read,
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

describe("sumCosts", () => {
  test("adds known costs and is unknown if any part is", () => {
    assert.equal(sumCosts([1, 2.5]), 3.5);
    assert.equal(sumCosts([1, null]), null);
    assert.equal(sumCosts([]), 0);
  });
});

describe("buildProjects", () => {
  const raw = loadPaths([projectsFolder()]);
  const [p, ...rest] = buildProjects(raw);

  test("drops projects with no API calls and names the rest by cwd", () => {
    assert.equal(rest.length, 0);
    assert.equal(p.name, "/repos/app");
  });

  test("totals sessions and subagents", () => {
    const [s] = p.sessions;

    assert.equal(p.callCount, 2);
    assert.equal(p.subagentCount, 1);
    assert.equal(p.totals.output, 100);
    assert.equal(s.id, "s1");
    assert.equal(s.subagents[0].id, "1");
    assert.equal(s.start, "2026-11-27T01:00:01.000Z");
  });

  test("does not change the raw data", () => {
    assert.equal(raw[0].sessions[0].totals, undefined);
  });

  test("tells apart two folders that recorded the same cwd", () => {
    const twice = buildProjects([raw[0], { ...raw[0], dir: "/elsewhere/copy" }]);

    assert.deepEqual(
      twice.map((x) => x.name),
      ["/repos/app (-repos-app)", "/repos/app (copy)"],
    );
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

describe("allTurns", () => {
  test("lists session and subagent turns newest first, priced", () => {
    const projects = buildProjects(loadPaths([projectsFolder()]));
    const rates = { "claude-opus-5-5": { base: price(0, 1, 0, 0, 0), tiers: [], multipliers: {} } };
    const turns = allTurns(projects, rates);

    assert.deepEqual(
      turns.map((t) => [t.prompt, t.subagent, t.cost]),
      [
        ["subagent task", true, 50],
        ["main prompt", false, 50],
      ],
    );
  });
});

describe("windowOf", () => {
  const now = new Date("2026-11-27T22:00:00.000Z");

  test("starts a 5-hour or weekly window that long before it resets", () => {
    const resetsAt = new Date("2026-11-28T01:30:00.000Z");

    assert.deepEqual(windowOf("5h", { percent: 40, resetsAt }, now), {
      kind: "5h",
      start: new Date("2026-11-27T20:30:00.000Z"),
      end: resetsAt,
      percent: 40,
    });
    assert.equal(
      windowOf("week", { percent: 75, resetsAt }, now).start.toISOString(),
      "2026-11-21T01:30:00.000Z",
    );
  });

  test("starts at now when no window is open", () => {
    assert.deepEqual(windowOf("5h", { percent: 0, resetsAt: null }, now), {
      kind: "5h",
      start: now,
      end: null,
      percent: 0,
    });
  });

  test("covers the calendar month in local time", () => {
    const w = windowOf("month", null, new Date(2026, 10, 27, 12));

    assert.deepEqual(w, {
      kind: "month",
      start: new Date(2026, 10, 1),
      end: new Date(2026, 11, 1),
      percent: null,
    });
  });
});

describe("buildProjects with since", () => {
  const root = join(tempDir(), "projects");

  transcript(join(root, "-repos-w", "s.jsonl"), [
    user("old", "2026-11-27T10:00:00.000Z", { cwd: "/repos/w" }),
    assistant("a", USAGE, "2026-11-27T10:00:05.000Z"),
    user("spans", "2026-11-27T11:59:00.000Z"),
    assistant("b", USAGE, "2026-11-27T11:59:30.000Z"),
    assistant("c", USAGE, "2026-11-27T12:00:30.000Z"),
    user("new", "2026-11-27T13:00:00.000Z"),
    assistant("d", USAGE, "2026-11-27T13:00:05.000Z"),
  ]);
  const raw = loadPaths([root]);
  const since = new Date("2026-11-27T12:00:00.000Z");

  test("keeps the turns that reach the window, the spanning one whole and marked", () => {
    const turns = allTurns(buildProjects(raw, { since }), null);

    assert.deepEqual(
      turns.map((t) => [t.prompt, t.calls.length, t.beforeWindow]),
      [
        ["new", 1, false],
        ["spans", 2, true],
      ],
    );
  });

  test("totals only the kept turns and leaves the raw data alone", () => {
    const [p] = buildProjects(raw, { since });

    assert.equal(p.callCount, 3);
    assert.equal(raw[0].sessions[0].turns.length, 3);
    assert.equal(raw[0].sessions[0].turns[1].beforeWindow, undefined);
  });

  test("drops a project with no turns in the window", () => {
    assert.deepEqual(buildProjects(raw, { since: new Date("2026-11-28T00:00:00.000Z") }), []);
  });
});
