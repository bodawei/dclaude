// The command line, bin/dclaude.mjs, run as a separate process.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { projectsFolder } from "./helpers.mjs";

const BIN = fileURLToPath(new URL("../bin/dclaude.mjs", import.meta.url));
const run = (...args) => execFileSync(process.execPath, [BIN, ...args], { encoding: "utf8" });

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
});
