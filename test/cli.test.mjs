// The command line, bin/dclaude.mjs, run as a separate process.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { projectsFolder, tempDir } from "./helpers.mjs";

const BIN = fileURLToPath(new URL("../bin/dclaude.mjs", import.meta.url));
const README = fileURLToPath(new URL("../README.md", import.meta.url));
const run = (...args) => execFileSync(process.execPath, [BIN, ...args], { encoding: "utf8" });

/** The options --help lists: lines in its Options section that start with two spaces and "-". */
function helpOptions() {
  const help = run("--help");
  const start = help.indexOf("\nOptions:\n");
  const section = help.slice(start, help.indexOf("\n\n", start + 1));
  const names = [...section.matchAll(/^ {2}(-[\w-]+)(?:, (-[\w-]+))?/gm)];

  return names.flatMap((m) => m.slice(1).filter(Boolean)).toSorted();
}

/** The options README.md's option table lists, from the backticked names in its first column. */
function readmeOptions() {
  const text = readFileSync(README, "utf8");
  const table = text.slice(
    text.indexOf("| Option"),
    text.indexOf("\n\n", text.indexOf("| Option")),
  );
  const firstCells = table.split("\n").map((row) => row.split("|")[1] ?? "");

  return firstCells
    .flatMap((cell) => [...cell.matchAll(/`(-[\w-]+)`/g)].map((m) => m[1]))
    .toSorted();
}

describe("bin/dclaude.mjs", () => {
  const root = projectsFolder();

  test("writes a CSV row per API call", () => {
    const [header, ...rows] = run(root, "--csv").trim().split("\n");

    assert.match(header, /^project,/);
    assert.equal(rows.length, 2);
  });

  test("writes the Markdown report by default", () => {
    assert.match(run(root), /^# Claude Code usage report\n/);
  });

  test("rejects an unknown option", () => {
    assert.throws(
      () => execFileSync(process.execPath, [BIN, "--nope"], { stdio: "pipe" }),
      (e) => e.status === 2 && String(e.stderr).includes("Unknown option: --nope"),
    );
  });

  test("rejects a --window it doesn't know", () => {
    assert.throws(
      () => execFileSync(process.execPath, [BIN, root, "--window", "day"], { stdio: "pipe" }),
      (e) => e.status === 2 && String(e.stderr).includes("--window must be one of 5h, week, month"),
    );
  });

  test("stops when --window 5h can't run claude", () => {
    const env = { ...process.env, PATH: tempDir() };

    assert.throws(
      () => execFileSync(process.execPath, [BIN, root, "--window", "5h"], { stdio: "pipe", env }),
      (e) =>
        e.status === 1 && String(e.stderr).includes("claude (Claude Code) is not on your PATH"),
    );
  });

  test("accepts every option --help lists", () => {
    for (const option of ["--summary", "--no-calls", "--csv", "--hide-worktrees"]) {
      assert.ok(helpOptions().includes(option), option);
      run(root, option);
    }
  });
});

describe("documentation", () => {
  test("README.md and --help list the same options", () => {
    const help = helpOptions();

    assert.ok(help.length > 0);
    assert.deepEqual(readmeOptions(), help);
  });
});
