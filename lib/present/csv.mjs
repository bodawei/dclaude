// LAYER 3: PRESENTATION. The CSV report (--csv).
//
// Prepares and renders Project[] from lib/transform/projects.mjs as CSV: one row per API call,
// per turn (--no-calls) or per project (--summary). Times are ISO 8601 UTC, exactly as the
// transcripts record them. Returns text; bin/dclaude.mjs writes it to stdout.

import { FIELDS, sum } from "../transform/projects.mjs";
import { clean, joined, secs, turnFlags } from "./common.mjs";

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(",") + "\n";
const tokens = (d) => FIELDS.map((f) => d[f]);

/** One row per project (--summary). */
function csvSummary(projects) {
  let out = csvRow([
    "project",
    "first",
    "last",
    "sessions",
    "subagents",
    "turns",
    "calls",
    ...FIELDS,
  ]);
  for (const p of projects) {
    out += csvRow([
      p.name,
      p.start,
      p.end,
      p.sessions.length,
      p.subagentCount,
      p.turnCount,
      p.callCount,
      ...tokens(p.totals),
    ]);
  }
  return out;
}

/** One row per API call, or per turn when showCalls is false (--no-calls). */
function csvReport(projects, showCalls) {
  const out = [
    csvRow([
      "project",
      "workspace",
      "session_id",
      "session_title",
      "agent_id",
      "agent_type",
      "agent_description",
      "turn",
      showCalls ? "call" : "calls",
      "time",
      "secs",
      "model",
      "thinking_level",
      "flags",
      ...FIELDS,
      "prompt",
    ]),
  ];
  for (const p of projects) {
    for (const s of p.sessions) {
      for (const t of [s, ...s.subagents]) {
        const sub = t !== s;
        const ctx = [
          p.name,
          s.workspace ?? "",
          s.id,
          s.title ?? "",
          sub ? t.id : "",
          sub ? (t.meta.agentType ?? "") : "",
          sub ? (t.meta.description ?? "") : "",
        ];
        t.turns.forEach((turn, i) => {
          if (turn.calls.length === 0) return;
          const prompt = clean(turn.prompt).replaceAll("\\|", "|");
          if (showCalls) {
            turn.calls.forEach((c, j) =>
              out.push(
                csvRow([
                  ...ctx,
                  i + 1,
                  j + 1,
                  c.start,
                  secs(c.start, c.end, ""),
                  c.model,
                  c.effort,
                  c.flags.join(", "),
                  ...tokens(c),
                  prompt,
                ]),
              ),
            );
          } else {
            const first = turn.calls[0],
              last = turn.calls.at(-1);
            out.push(
              csvRow([
                ...ctx,
                i + 1,
                turn.calls.length,
                first.start,
                secs(first.start, last.end, ""),
                joined(turn.calls, "model"),
                joined(turn.calls, "effort"),
                turnFlags(turn.calls),
                ...tokens(sum(turn.calls)),
                prompt,
              ]),
            );
          }
        });
      }
    }
  }
  return out.join("");
}

export { csvReport, csvSummary };
