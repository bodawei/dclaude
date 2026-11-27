// LAYER 3: PRESENTATION. The live view (--tail).
//
// Prepares the newest turns (TurnEntry[] from lib/transform/projects.mjs) as screen rows and
// lays them out for the terminal's size: a header, column headings, and turns grouped under a
// line per project, with the --window window, if any, in the header. tailFrame() is pure and
// returns the lines; runTail() owns the terminal (alternate screen, refresh every second, the
// q key).

import { sumCosts } from "../transform/costs.mjs";
import { fit, fmt, isoStamp, money, tilde, turnFlags, windowText } from "./common.mjs";

/** "claude-opus-5-5" -> "opus-5-5"; a turn that used several models -> "multiple". */
function turnModel(calls) {
  const used = calls.filter((c) => c.input + c.output > 0);
  const models = [
    ...new Set((used.length ? used : calls).map((c) => c.model.replace(/^claude-/, ""))),
  ];
  return models.length > 1 ? "multiple" : (models[0] ?? "-");
}

/** Effort level(s) and flags of a turn, e.g. "high fast" (the least important --tail info). */
function turnExtra(calls) {
  if (calls.length === 0) return "-";
  const efforts = [...new Set(calls.map((c) => c.effort).filter((e) => e && e !== "—"))];
  return [efforts.join("/"), turnFlags(calls).replaceAll(", ", " ")].filter(Boolean).join(" ");
}

/**
 * TurnEntry -> the values one --tail turn line shows. "↳" marks a subagent turn, "↤" a turn
 * that started before the --window window.
 */
const tailRow = (t) => ({
  project: tilde(t.project),
  ts: t.ts,
  model: (t.subagent ? "↳ " : "") + (t.beforeWindow ? "↤ " : "") + turnModel(t.calls),
  extra: turnExtra(t.calls),
  inputNew: t.totals.new_input + t.totals.cache_write,
  inputCached: t.totals.cache_read,
  output: t.totals.output,
  prompt: t.prompt.split(/\s+/).join(" ").trim(),
  cost: t.cost,
});

/**
 * The lines below the column headings: a project line each time the project changes (with
 * the cost of that run of turns), then one indented line per turn. At most `max` lines, and
 * never a project line with no turn under it.
 */
function tailLines(turns, rates, max) {
  const lines = [];
  for (let i = 0; i < turns.length && lines.length < max;) {
    let j = i;
    while (j < turns.length && turns[j].project === turns[i].project) j++;
    const run = turns.slice(i, j);
    const cost = rates ? sumCosts(run.map((t) => t.cost)) : null;
    if (lines.length + 1 >= max) break;
    lines.push({ project: run[0].project, latest: run[0].ts, cost });
    for (const t of run) {
      if (lines.length >= max) break;
      lines.push({ turn: t });
    }
    i = j;
  }
  return lines;
}

const PATH_MIN = 20;

/**
 * A --tail project line's text: the path, then the time of its latest turn, in `room`
 * characters at most. As room runs out, the time shrinks first: "latest" goes, then the
 * date, then the hours, then all of it. The path keeps up to PATH_MIN characters.
 */
function projectLabel(project, latestIso, room) {
  const stamp = isoStamp(latestIso),
    clock = stamp.slice(11);
  const latest =
    [`  (latest ${stamp})`, `  (${stamp})`, `  (${clock})`, `  (${clock.slice(3)})`, ""].find(
      (x) => Math.min(project.length, PATH_MIN) + x.length <= room,
    ) ?? "";
  return fit(project, Math.max(1, Math.min(project.length, room - latest.length))) + latest;
}

const PROMPT_W = 20,
  GAP = " ",
  INDENT = "    ";

/**
 * One screen of --tail for TurnEntry[] (newest first), `rows` high and `cols` wide, as lines
 * with terminal styling (bold, reverse video) but no cursor movement. `window` is the
 * --window Window (lib/transform/windows.mjs), with `error` set when it can't be retrieved.
 */
function tailFrame(entries, rates, { rows, cols, now, window = null }) {
  const turns = entries.map(tailRow);
  const HEADS = [
    "PROJECT / MODEL",
    "INPUT-NEW",
    "INPUT-CACHED",
    "OUTPUT",
    "PROMPT",
    ...(rates ? ["COST"] : []),
  ];
  const body = tailLines(turns, rates, Math.max(0, rows - 2));
  const shown = body.filter((l) => l.turn).map((l) => l.turn);
  const cells = shown.map((t) => [
    INDENT + t.model,
    fmt(t.inputNew),
    fmt(t.inputCached),
    fmt(t.output),
    t.prompt,
    ...(rates ? [money(t.cost)] : []),
  ]);
  const groupCosts = body.filter((l) => !l.turn).map((l) => money(l.cost));
  // Number columns are as wide as their widest value or header.
  const w = HEADS.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  if (rates) w[5] = Math.max(w[5], ...groupCosts.map((c) => c.length));
  const fixed = w[1] + w[2] + w[3] + (rates ? w[5] + GAP.length : 0) + 4 * GAP.length;
  // The rest is split between the first column (model, then effort/flags) and the prompt.
  // On a narrow screen, give up the effort/flags first, then the prompt, then the model
  // (down to 1), rather than let the right edge clip the cost.
  const extraW = Math.max(0, ...shown.map((t) => (t.extra ? t.extra.length + 1 : 0)));
  const room = cols - fixed;
  const modelW = Math.max(1, Math.min(w[0], room));
  const promptW = Math.max(0, Math.min(PROMPT_W, room - modelW));
  const firstW = modelW + Math.max(0, Math.min(extraW, room - modelW - promptW));
  const lastW = Math.max(promptW, room - firstW); // a wide screen shows more of the prompt
  const line = (c) =>
    [
      fit(c[0], firstW),
      c[1].padStart(w[1]),
      c[2].padStart(w[2]),
      c[3].padStart(w[3]),
      rates ? fit(c[4], lastW) : fit(c[4], lastW).trimEnd(),
      ...(rates ? [c[5].padStart(w[5])] : []),
    ]
      .join(GAP)
      .trimEnd()
      .slice(0, cols);
  const first = (t) => {
    const m = INDENT + t.model;
    return t.extra && firstW > m.length ? fit(m.padEnd(w[0]) + " " + t.extra, firstW) : m;
  };
  const turnLine = (t) =>
    line([
      first(t),
      fmt(t.inputNew),
      fmt(t.inputCached),
      fmt(t.output),
      t.prompt,
      ...(rates ? [money(t.cost)] : []),
    ]);
  // A project line: the path across the row, and the run's total under COST.
  const projectLine = (l) => {
    const costCell = rates ? GAP + money(l.cost).padStart(w[5]) : "";
    const labelRoom = cols - costCell.length;
    const label = projectLabel(l.project, l.latest, labelRoom);
    const text = rates ? fit(label, labelRoom) + costCell : fit(label, cols).trimEnd();
    return "\x1b[1m" + text.slice(0, cols) + "\x1b[0m";
  };
  const total = rates ? sumCosts(turns.map((t) => t.cost)) : null;
  return [
    fit(
      `Claude Code usage · ${isoStamp(now.toISOString())} · ${turns.length} turns` +
        (rates ? ` ${money(total)} cost` : "") +
        (window ? ` · ${windowText(window)}` : "") +
        " · q to quit",
      cols,
    ),
    "\x1b[7m" + fit(line(HEADS), cols) + "\x1b[0m",
    ...body.map((l) => (l.turn ? turnLine(l.turn) : projectLine(l))),
  ];
}

/**
 * Run the live view until q or Ctrl-C. getTurns() reloads TurnEntry[] for every refresh;
 * getWindow() returns the --window Window to show in the header, or null.
 */
function runTail(getTurns, rates, getWindow = () => null) {
  const out = process.stdout;
  const render = () => {
    // Stay off the last column: after a character there, the "\x1b[K" below erases it in
    // some terminals (e.g. macOS Terminal).
    const lines = tailFrame(getTurns(), rates, {
      rows: out.rows || 24,
      cols: (out.columns || 80) - 1,
      now: new Date(),
      window: getWindow(),
    });
    out.write("\x1b[H" + lines.map((l) => l + "\x1b[K").join("\n") + "\x1b[J");
  };
  const quit = () => {
    out.write("\x1b[?25h\x1b[?1049l"); // show cursor, leave alternate screen
    process.exit(0);
  };
  out.write("\x1b[?1049h\x1b[?25l"); // alternate screen, hide cursor
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (k) => {
      const key = k.toString();
      if (key === "q" || key === "\x03") quit(); // q or Ctrl-C (raw mode swallows SIGINT)
    });
  }
  // Terminals rewrap the old frame when the window changes size; wipe it before redrawing.
  out.on("resize", () => {
    out.write("\x1b[2J");
    render();
  });
  render();
  setInterval(render, 1000);
}

export { projectLabel, runTail, tailFrame, tailLines, turnExtra, turnModel };
