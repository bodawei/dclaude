// LAYER 2: TRANSFORMATION. Projects, sessions and turns.
//
// Turns the raw data from lib/load/transcripts.mjs into what every report works from:
// totals, start and end times, ids, empty sessions and projects dropped, worktree and
// Conductor workspace folders merged (--hide-worktrees), duplicate project names told apart,
// and every turn listed newest first. Nothing here depends on how the result is shown.
//
// Pure functions: no I/O, and the raw data is never mutated (--tail reuses it). Imports
// nothing from lib/present/.

import { basename } from "node:path";

import { costOf } from "./costs.mjs";

/**
 * Shapes returned by this file (Raw* and Turn/Call are in lib/load/transcripts.mjs):
 *   Project   { dir, name, sessions: Session[], start, end, totals, turnCount, callCount,
 *               subagentCount }
 *   Session   RawSession + { id, workspace, start, end, totals, callCount,
 *               subagents: Subagent[] }
 *   Subagent  RawSubagent + { id, start, end, totals, callCount }
 *   Totals    { input, output, new_input, cache_write, cache_read, thinking }
 *   TurnEntry { project, subagent, ts, prompt, calls, totals, cost }
 */

const FIELDS = ["input", "output", "new_input", "cache_write", "cache_read", "thinking"];

/** Totals of the FIELDS over calls, turns or projects. */
function sum(items) {
  const t = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  for (const it of items) for (const f of FIELDS) t[f] += it[f] ?? 0;
  return t;
}

/** A transcript plus its start, end, totals and call count. */
function summarize(t) {
  const calls = t.turns.flatMap((turn) => turn.calls);
  return {
    ...t,
    start: calls[0]?.start ?? null,
    end: calls.at(-1)?.end ?? null,
    totals: sum(calls),
    callCount: calls.length,
  };
}

// Workspace folders that belong to one project: [project, workspace] capture groups.
const WORKSPACE_RES = [
  /^(.*)\/\.claude\/worktrees\/([^/]+)/, // Claude Code: <project>/.claude/worktrees/<workspace>
  /^(.*\/conductor\/workspaces\/[^/]+)\/([^/]+)/, // Conductor: .../conductor/workspaces/<project>/<workspace>
];
const matchWorkspace = (path) => {
  for (const re of WORKSPACE_RES) {
    const m = path?.match(re);
    if (m) return m;
  }
  return null;
};

/** Workspace name of a session inside a Claude Code worktree or conductor workspace, else null. */
const workspaceOf = (s) => matchWorkspace(s.cwd)?.[2] ?? null;

function prepareSession(s) {
  const subagents = s.subagents
    .map((sub) => ({ ...summarize(sub), id: basename(sub.path, ".jsonl").replace(/^agent-/, "") }))
    .filter((sub) => sub.callCount > 0);
  return { ...summarize(s), id: basename(s.path, ".jsonl"), workspace: workspaceOf(s), subagents };
}

/** Build a project record (with totals) from its sessions. */
function makeProject(name, dir, sessions) {
  sessions = [...sessions].toSorted((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  const all = sessions.flatMap((s) => [s, ...s.subagents]);
  const starts = all
    .map((s) => s.start)
    .filter(Boolean)
    .toSorted();
  const ends = all
    .map((s) => s.end)
    .filter(Boolean)
    .toSorted();
  return {
    dir,
    name,
    sessions,
    start: starts[0] ?? null,
    end: ends.at(-1) ?? null,
    totals: sum(all.map((s) => s.totals)),
    turnCount: all.reduce((n, s) => n + s.turns.length, 0),
    callCount: all.reduce((n, s) => n + s.callCount, 0),
    subagentCount: sessions.reduce((n, s) => n + s.subagents.length, 0),
  };
}

/** A RawProject as a Project, named by its sessions' cwd, without sessions that made no calls. */
function prepareProject(raw) {
  const sessions = raw.sessions
    .map(prepareSession)
    .filter((s) => s.callCount > 0 || s.subagents.length > 0);
  return makeProject(sessions.find((s) => s.cwd)?.cwd ?? basename(raw.dir), raw.dir, sessions);
}

/** Merge Claude Code worktree and conductor workspace folders into one project each. */
function groupWorkspaces(projects) {
  const out = [],
    groups = new Map();
  for (const p of projects) {
    const m = matchWorkspace(p.name);
    if (!m) {
      out.push(p);
      continue;
    }
    if (!groups.has(m[1])) groups.set(m[1], []);
    groups.get(m[1]).push(p);
  }
  for (const [name, members] of groups) {
    const existing = out.findIndex((p) => p.name === name); // sessions run in the project itself
    if (existing >= 0) members.unshift(...out.splice(existing, 1));
    out.push(
      makeProject(
        name,
        members.map((p) => p.dir).join(", "),
        members.flatMap((p) => p.sessions),
      ),
    );
  }
  return out.toSorted((a, b) => a.name.localeCompare(b.name));
}

/** Two folders can record the same cwd (e.g. a copied or renamed project folder). */
function distinctNames(projects) {
  const counts = Map.groupBy(projects, (p) => p.name);
  return projects.map((p) =>
    counts.get(p.name).length > 1 ? { ...p, name: `${p.name} (${basename(p.dir)})` } : p,
  );
}

/** RawProject[] -> Project[]: the model every report uses. */
function buildProjects(rawProjects, { hideWorktrees = false } = {}) {
  let projects = rawProjects.map(prepareProject).filter((p) => p.sessions.length > 0);
  if (hideWorktrees) projects = groupWorkspaces(projects);
  return distinctNames(projects);
}

/** Every turn across all projects (subagent turns included), newest first, with its cost. */
function allTurns(projects, rates) {
  const out = [];
  for (const p of projects) {
    for (const s of p.sessions) {
      for (const t of [s, ...s.subagents]) {
        for (const turn of t.turns) {
          out.push({
            project: p.name,
            subagent: t !== s,
            ts: turn.calls[0]?.start ?? turn.ts ?? "",
            prompt: turn.prompt,
            calls: turn.calls,
            totals: sum(turn.calls),
            cost: rates ? costOf(turn.calls, rates) : null,
          });
        }
      }
    }
  }
  return out.toSorted((a, b) => b.ts.localeCompare(a.ts));
}

export { allTurns, buildProjects, FIELDS, groupWorkspaces, makeProject, sum };
