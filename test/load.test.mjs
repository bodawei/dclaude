// Layer 1, loading: lib/load/transcripts.mjs, lib/load/prices.mjs and lib/load/usage.mjs.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { loadCosts, parseCosts } from "../lib/load/prices.mjs";
import { loadPaths, parseTranscriptUncached } from "../lib/load/transcripts.mjs";
import { parseReset, parseUsage, readUsage } from "../lib/load/usage.mjs";
import { assistant, projectsFolder, tempDir, transcript, USAGE, user } from "./helpers.mjs";

describe("parseTranscriptUncached", () => {
  const path = transcript(join(tempDir(), "session.jsonl"), [
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

    assert.equal(first.output, 50);
    assert.equal(first.input, 1103);
    assert.equal(first.end, "2026-11-27T01:00:02.000Z");
    assert.equal(first.effort, "high");
  });

  test("records non-default modes as flags", () => {
    assert.deepEqual(t.turns[1].calls[0].flags, ["fast"]);
  });

  test("leaves totals to the transformation layer", () => {
    assert.equal(t.totals, undefined);
  });
});

describe("loadPaths", () => {
  test("returns every project folder as found, empty ones included", () => {
    const raw = loadPaths([projectsFolder()]);

    assert.deepEqual(
      raw.map((p) => p.sessions.length),
      [1, 1],
    );
    assert.equal(raw[0].sessions[0].subagents[0].turns[0].prompt, "subagent task");
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

describe("loadCosts", () => {
  test("throws with the file's path instead of exiting", () => {
    const path = join(tempDir(), "costs");

    writeFileSync(path, "{ not json");

    assert.throws(
      () => loadCosts(path),
      (e) => e.path === path,
    );
  });
});

const NOW = new Date(Date.UTC(2026, 10, 27, 22, 0));
const USAGE_TEXT = [
  "You are currently using your subscription to power your Claude Code usage",
  "",
  "Current session: 40% used · resets Nov 28 at 1:30am (UTC)",
  "Current week (all models): 75% used · resets Nov 28 at 2am (UTC)",
].join("\n");

describe("parseReset", () => {
  test("reads a date with or without minutes", () => {
    assert.equal(
      parseReset("Nov 28 at 1:30am (UTC)", NOW).toISOString(),
      "2026-11-28T01:30:00.000Z",
    );
    assert.equal(parseReset("Nov 28 at 12pm (UTC)", NOW).toISOString(), "2026-11-28T12:00:00.000Z");
    assert.equal(parseReset("Nov 28 at 12am (UTC)", NOW).toISOString(), "2026-11-28T00:00:00.000Z");
  });

  test("picks the year closest to now", () => {
    const lateDecember = new Date(Date.UTC(2026, 11, 31, 22, 0));

    assert.equal(
      parseReset("Jan 2 at 3am (UTC)", lateDecember).toISOString(),
      "2027-01-02T03:00:00.000Z",
    );
  });

  test("reads a time without a date as the nearest such time", () => {
    assert.equal(parseReset("11:30pm (UTC)", NOW).toISOString(), "2026-11-27T23:30:00.000Z");
  });

  test("rejects anything else, including a time not in UTC", () => {
    assert.throws(() => parseReset("Nov 28 at 1:30am (America/Los_Angeles)", NOW), /reset time/);
    assert.throws(() => parseReset("Foo 28 at 1am (UTC)", NOW), /month/);
  });
});

describe("parseUsage", () => {
  test("reads the percentage and reset of each window", () => {
    assert.deepEqual(parseUsage(USAGE_TEXT, "5h", NOW), {
      percent: 40,
      resetsAt: new Date("2026-11-28T01:30:00.000Z"),
    });
    assert.deepEqual(parseUsage(USAGE_TEXT, "week", NOW), {
      percent: 75,
      resetsAt: new Date("2026-11-28T02:00:00.000Z"),
    });
  });

  test("gives no reset time when no window is open", () => {
    assert.deepEqual(parseUsage("Current session: 0% used\n", "5h", NOW), {
      percent: 0,
      resetsAt: null,
    });
  });

  test("throws when the line is missing", () => {
    assert.throws(() => parseUsage("something else", "week", NOW), /Current week/);
  });
});

describe("readUsage", () => {
  test("parses what the given runner returns", async () => {
    const usage = await readUsage("5h", NOW, async () => USAGE_TEXT);

    assert.equal(usage.percent, 40);
  });
});
