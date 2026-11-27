// LAYER 3: PRESENTATION. The Markdown report (the default output).
//
// Prepares and renders Project[] from lib/transform/projects.mjs as Markdown: a summary
// table by project, then each project's sessions with one row per turn and, optionally, per
// API call. Returns text; bin/dclaude.mjs writes it to stdout.

import { FIELDS, sum } from "../transform/projects.mjs";
import { clean, fmt, fmtTime, joined, secs, turnFlags } from "./common.mjs";

const bold = (x) => `**${x}**`;
const row = (cells) => "| " + cells.join(" | ") + " |";

/** Token totals as table cells: the first two (input, output) and the rest. */
const nums = (d, b = false) => {
  const v = FIELDS.map((f) => (b ? bold(fmt(d[f])) : fmt(d[f])));
  return { io: v.slice(0, 2), rest: v.slice(2) };
};

function summaryTable(projects) {
  const lines = ["## Summary by project\n"];
  lines.push(
    row([
      "project",
      "first",
      "last",
      "sessions",
      "subagents",
      "turns",
      "calls",
      "input",
      "output",
      "new-input",
      "cache_write",
      "cache_read",
      "thinking",
    ]),
  );
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  const sorted = [...projects].toSorted((a, b) => (b.end ?? "").localeCompare(a.end ?? ""));
  for (const p of sorted) {
    const { io, rest } = nums(p.totals);
    lines.push(
      row([
        clean(p.name, 80),
        fmtTime(p.start, false),
        fmtTime(p.end, false),
        p.sessions.length,
        p.subagentCount,
        p.turnCount,
        p.callCount,
        ...io,
        ...rest,
      ]),
    );
  }
  const g = sum(projects.map((p) => p.totals));
  const { io, rest } = nums(g, true);
  const n = (k) => bold(projects.reduce((s, p) => s + p[k], 0));
  lines.push(
    row([
      bold("total"),
      "",
      "",
      bold(projects.reduce((s, p) => s + p.sessions.length, 0)),
      n("subagentCount"),
      n("turnCount"),
      n("callCount"),
      ...io,
      ...rest,
    ]),
  );
  lines.push("");
  return lines;
}

/** One table for a session or subagent: a row per turn, plus a row per call. */
function transcriptTable(t, showCalls) {
  const lines = [
    row([
      "turn",
      "time",
      "secs",
      "model",
      "thinking-level",
      "flags",
      "input",
      "output",
      "calls",
      "new-input",
      "cache_write",
      "cache_read",
      "thinking",
      "first 100 input chars",
    ]),
    "|---|---|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|",
  ];
  t.turns.forEach((turn, i) => {
    if (turn.calls.length === 0) return;
    const first = turn.calls[0],
      last = turn.calls.at(-1);
    const { io, rest } = nums(sum(turn.calls));
    lines.push(
      row([
        bold(i + 1),
        fmtTime(first.start),
        secs(first.start, last.end),
        joined(turn.calls, "model"),
        joined(turn.calls, "effort"),
        turnFlags(turn.calls),
        ...io,
        turn.calls.length,
        ...rest,
        clean(turn.prompt),
      ]),
    );
    if (showCalls && turn.calls.length > 1) {
      turn.calls.forEach((c, j) => {
        const n = nums(c);
        lines.push(
          row([
            `${i + 1}.${j + 1}`,
            fmtTime(c.start),
            secs(c.start, c.end),
            c.model,
            c.effort,
            c.flags.join(", "),
            ...n.io,
            "",
            ...n.rest,
            "",
          ]),
        );
      });
    }
  });
  const { io, rest } = nums(t.totals, true);
  lines.push(row([bold("total"), "", "", "", "", "", ...io, t.callCount, ...rest, ""]), "");
  return lines;
}

function projectSection(p, showCalls) {
  const lines = [`## ${p.name}\n`];
  for (const s of p.sessions) {
    lines.push(`### ${s.title ? clean(s.title) + " — " : ""}${fmtTime(s.start)}\n`);
    lines.push(`Session ID: \`${s.id}\`${s.workspace ? ` · Workspace: \`${s.workspace}\`` : ""}\n`);
    if (s.callCount > 0) lines.push(...transcriptTable(s, showCalls));
    for (const sub of s.subagents) {
      const what = [sub.meta.agentType, sub.meta.description].filter(Boolean).join(": ");
      lines.push(`#### ↳ subagent${what ? " — " + clean(what) : ""}\n`);
      lines.push(`Agent ID: \`${sub.id}\`\n`);
      lines.push(...transcriptTable(sub, showCalls));
    }
  }
  return lines;
}

/** The whole report. `summaryOnly` stops after the summary table (--summary). */
function markdownReport(
  projects,
  { showCalls = true, summaryOnly = false, now = new Date() } = {},
) {
  const lines = [
    `# Claude Code usage report\n`,
    `${projects.length} project(s) · generated ${fmtTime(now.toISOString())}\n`,
    ...summaryTable(projects),
  ];
  if (!summaryOnly) for (const p of projects) lines.push(...projectSection(p, showCalls));
  return lines.map((l) => l + "\n").join("");
}

export { markdownReport };
