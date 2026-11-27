// Layer 3, presentation: lib/present/*.mjs, given data shaped like the transformation layer's.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { loadPaths } from "../lib/load/transcripts.mjs";
import { secs } from "../lib/present/common.mjs";
import { csvReport, csvSummary } from "../lib/present/csv.mjs";
import { markdownReport } from "../lib/present/markdown.mjs";
import {
  activeShade,
  projectLabel,
  tailFrame,
  tailLines,
  turnExtra,
  turnModel,
} from "../lib/present/tail.mjs";
import { allTurns, buildProjects } from "../lib/transform/projects.mjs";
import { call, projectsFolder } from "./helpers.mjs";

const projects = buildProjects(loadPaths([projectsFolder()]));

describe("common", () => {
  test("secs shows one decimal, or the given placeholder for a missing time", () => {
    assert.equal(secs("2026-11-27T01:00:00.000Z", "2026-11-27T01:00:01.250Z"), "1.3");
    assert.equal(secs(null, "2026-11-27T01:00:00.000Z"), "—");
    assert.equal(secs(null, null, ""), "");
  });
});

describe("markdownReport", () => {
  const now = new Date(2026, 10, 27, 12, 0, 0);

  test("starts with the title, the project count and the summary table", () => {
    const md = markdownReport(projects, { summaryOnly: true, now });

    assert.ok(
      md.startsWith("# Claude Code usage report\n\n1 project(s) · generated 2026-11-27 12:00:00\n"),
    );
    assert.match(md, /\| \/repos\/app \| [\d-]+ \| [\d-]+ \| 1 \| 1 \| 2 \| 2 \|/);
    assert.ok(!md.includes("## /repos/app"));
  });

  test("lists each session and subagent", () => {
    const md = markdownReport(projects, { now });

    assert.match(md, /## \/repos\/app\n/);
    assert.match(md, /Session ID: `s1`/);
    assert.match(md, /Agent ID: `1`/);
  });
});

describe("csv", () => {
  test("writes a row per API call", () => {
    const [header, ...rows] = csvReport(projects, true).trim().split("\n");

    assert.match(header, /^project,workspace,session_id,/);
    assert.equal(rows.length, 2);
  });

  test("writes a row per project for --summary", () => {
    assert.equal(csvSummary(projects).trim().split("\n").length, 2);
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

/** The styling code a --tail line opens with, e.g. "\x1b[1m". */
const openingStyle = (l) => l.slice(0, l.indexOf("m") + 1);

describe("tailFrame", () => {
  const now = new Date(2026, 10, 27, 2, 26, 59);
  const rates = { "claude-opus-5-5": { base: {}, tiers: [], multipliers: {} } };
  const entries = allTurns(projects, null);

  for (const t of entries) t.cost = 0.5;

  test("the header shows the time, the turn count and the total cost", () => {
    const [header] = tailFrame(entries, rates, { rows: 10, cols: 100, now });

    assert.equal(
      header.trimEnd(),
      "Claude Code usage · 2026-11-27T02:26:59 · 2 turns $1.00 cost · q to quit",
    );
  });

  test("leaves the cost out without a price table", () => {
    const [header] = tailFrame(entries, null, { rows: 10, cols: 100, now });

    assert.ok(!header.includes("cost"));
  });

  test("fits every line in the given width and height", () => {
    const lines = tailFrame(entries, rates, { rows: 4, cols: 40, now });
    // eslint-disable-next-line no-control-regex
    const visible = lines.map((l) => l.replaceAll(/\x1b\[[0-9;]*m/g, ""));

    assert.equal(lines.length, 4);
    assert.ok(visible.every((l) => l.length <= 40));
  });

  test("shades turns active in the last 10 and 60 seconds, but not project lines", () => {
    const latest = Date.parse(entries[0].last);
    const shaded = (after) =>
      tailFrame(entries, rates, { rows: 10, cols: 100, now: new Date(latest + after * 1000) })
        .slice(2)
        .map(
          (l) =>
            ({ "\x1b[97;48;5;27m": "bright", "\x1b[97;48;5;18m": "dark" })[openingStyle(l)] ?? null,
        );

    // The project line, then its two turns, last active two seconds apart, newest first.
    assert.deepEqual(shaded(8), [null, "bright", "bright"]);
    assert.deepEqual(shaded(9), [null, "bright", "dark"]);
    assert.deepEqual(shaded(59), [null, "dark", null]);
    assert.deepEqual(shaded(61), [null, null, null]);
  });
});

describe("activeShade", () => {
  const now = new Date("2026-11-27T01:01:00.000Z");

  test("is bright, then dark, then gone as the turn ages", () => {
    assert.match(activeShade("2026-11-27T01:00:50.000Z", now), /48;5;27m/);
    assert.match(activeShade("2026-11-27T01:00:00.000Z", now), /48;5;18m/);
    assert.equal(activeShade("2026-11-27T00:59:59.000Z", now), null);
  });

  test("ignores a missing or unreadable time", () => {
    assert.equal(activeShade("", now), null);
    assert.equal(activeShade(undefined, now), null);
  });
});
