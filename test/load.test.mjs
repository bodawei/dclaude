// Layer 1, loading: lib/load/transcripts.mjs and lib/load/prices.mjs.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { loadCosts, parseCosts } from "../lib/load/prices.mjs";
import { loadPaths, parseTranscriptUncached } from "../lib/load/transcripts.mjs";
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

  test("records each turn's newest record time, tool results included", () => {
    const busy = parseTranscriptUncached(
      transcript(join(tempDir(), "busy.jsonl"), [
        user("run the tests", "2026-11-27T01:00:00.000Z"),
        assistant("b1", USAGE, "2026-11-27T01:00:01.000Z"),
        // A tool result and an untimed record after the last response.
        user([{ type: "tool_result", content: "ok" }], "2026-11-27T01:00:30.000Z"),
        { type: "last-prompt" },
      ]),
    );

    assert.deepEqual(
      t.turns.map((turn) => turn.last),
      ["2026-11-27T01:00:04.000Z", "2026-11-27T01:01:01.000Z"],
    );
    assert.equal(busy.turns[0].last, "2026-11-27T01:00:30.000Z");
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
