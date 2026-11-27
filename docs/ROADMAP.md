# Roadmap

Long-term, multi-session projects for dclaude. One-session tasks belong in `.context/todos.md`
or the PR description.

Status: `idea` → `onhold` → `next` → `active` → `blocked` → `done`

dclaude has no one-pager or PRD yet, so these entries come from the code-organization review of
2026-11-27 rather than from a product document. If product documents are written, re-derive this
roadmap from them.

Agents: read this before starting work. Update the overview row and the project's
`Current state` / `Next actions` when work changes them. Only mark something `done` after its
verification steps pass.

## Overview

| ID  | Status | Project                                     |
| --- | ------ | ------------------------------------------- |
| P0  | done   | Usage report, CSV, `--tail` and costs       |
| P1  | done   | Tests, lint, format and CI                  |
| P2  | done   | Separate `--tail` drawing from terminal I/O |
| P3  | done   | Small cleanups: shared cost sum, duplicates |
| P4  | done   | Three layers: load, transform, present      |
| P5  | idea   | Check the data shapes between layers        |
| P6  | idea   | Keep `--tail` cheap on a large history      |

## P0: Usage report, CSV, `--tail` and costs

### Goal

A local CLI that reads Claude Code transcripts and shows where tokens and money went, per
project, session, turn and API call.

### Done when

The Markdown and CSV reports, `--summary`, `--no-calls`, `--hide-worktrees` and `--tail` (with
per-turn and per-project costs from `~/.dclaude_costs.json`) work against a real `~/.claude/projects`.

### Current state

**Done 2026-11-27.** Everything above ships in `bin/dclaude.mjs` as one file with no
dependencies. PRs 1 to 5 added `--tail`, costs, per-project grouping, worktree merging and the
`--tail` header and project-line timestamps.

Verification at the time was manual: running each option against real transcripts. There were
no automated tests; P1 adds them.

## P1: Tests, lint, format and CI

### Goal

Make changes safe to review: an automated test suite, one formatter and one linter with
agreed defaults, and a PR check that fails when any of them do.

### Done when

`pnpm test`, `pnpm exec oxlint --deny-warnings` and `pnpm format:check` pass from a clean
checkout, and `.github/workflows/check.yml` runs them on every PR without changing any file.

### Current state

**Done 2026-11-27.** The suite in `test/` (one file per layer since P4) covers transcript
parsing (message-id de-duplication, turn boundaries, flags), the price file, `costOf` (tiers,
multipliers, unknown models), the `--tail` layout, workspace merging, project loading with
subagents, and the command line. `oxlint` and `oxfmt` are set up and the code base passes both.
`.github/workflows/check.yml` has run green on every PR since bodawei/dclaude#6, and its `check`
job is required for `main`.

## P2: Separate `--tail` drawing from terminal I/O

### Goal

`tail()` mixed loading data, working out column widths, building lines and handling the
terminal. Move the layout into a pure function that returns the lines, and leave the terminal
handling on its own.

### Done when

The header, the column layout and the narrow-screen behaviour are covered by tests that call the
pure function, with no pseudo-terminal.

### Current state

**Done 2026-11-27, as part of P4.** `tailFrame(entries, rates, { rows, cols, now })` in
`lib/present/tail.mjs` returns the lines; `runTail()` keeps the alternate screen, the refresh
and the `q` key. Tests cover the header (time, turn count, total cost, no cost without prices)
and that every line fits a 40-column, 4-row screen. `runTail()` itself has no automated test.

Verification: the first `--tail` frame at 120, 70 and 40 columns is byte-for-byte the same as
before, against a snapshot of real transcripts.

## P3: Small cleanups

### Goal

Remove duplicated logic found in the review: the "total cost, or unknown if any part is unknown"
rule written twice, `secs` and `secsNum` differing only in what they show for a missing time, and
workspace grouping sitting in the main section instead of with the data it changes.

### Current state

**Done 2026-11-27, as part of P4.** `sumCosts` in `lib/transform/costs.mjs`; `secs(a, b,
missing)` in `lib/present/common.mjs`; workspace grouping in `lib/transform/projects.mjs`.

## P4: Three layers: load, transform, present

### Goal

Separate the program into three layers, each in its own folder: loading files, transforming the
data independently of any output, and presenting it, with one file per output (Markdown, CSV,
`--tail`) and shared presentation helpers. `bin/dclaude.mjs` is only the command line.

### Done when

Each layer's files say which layer they are, imports point only down, loading and transformation
do no output, and every report is unchanged for the same input.

### Current state

**Done 2026-11-27.** The layout and the rules that keep the layers apart are in `AGENTS.md`
under Architecture. Tests are split the same way (`test/load`, `transform`, `present`, `cli`).

One deliberate change: a project folder or `.jsonl` file with no API calls used to give an
empty report; it now gives "No transcripts with usage found." like an empty projects root.

Verification: `pnpm test` (44 tests), lint and format check pass. Every Markdown and CSV mode
(`--summary`, `--no-calls`, `--hide-worktrees`, and their combinations), `--help`, and the first
`--tail` frame at three widths are byte-for-byte the same as before the split, against a
snapshot of real transcripts.

## P5: Check the data shapes between layers

### Goal

Catch a field renamed or dropped in one layer while another still reads it. Today the shapes
that cross layers (`RawProject`, `Project`, `TurnEntry`, `Call`, ...) are only described in the
header comments of `lib/load/transcripts.mjs` and `lib/transform/projects.mjs`, so nothing
checks them.

### Done when

Those shapes are JSDoc `@typedef`s, the functions that pass them between layers are annotated,
and CI runs `tsc --noEmit --checkJs` over `bin/` and `lib/` with no errors. The code stays plain
JavaScript that Node runs directly; there is no build step.

### Current state

Not started.

### Dependencies and open questions

- Adds `typescript` as a dev dependency, the first beyond the lint and format tools. It never
  ships (`files` in `package.json`).
- How strict to be: `strict` from the start, or `checkJs` first and tighten later. Transcript
  records are untrusted JSON, so their fields need optional types, not assertions.

### Next actions

- [ ] Turn the shape comments into `@typedef`s in the same two files.
- [ ] Annotate the cross-layer functions (`loadPaths`, `buildProjects`, `allTurns`, the
      presenters' entry points) and fix what `tsc` reports.
- [ ] Add the check to `.github/workflows/check.yml`.

### Verification

`pnpm exec tsc --noEmit` passes locally and in CI, and renaming a field on `Call` in the loading
layer makes it fail.

## P6: Keep `--tail` cheap on a large history

### Goal

`--tail` refreshes every second, and every refresh checks the size and modification time of
every transcript under `~/.claude/projects`, then rebuilds every total in the transformation
layer, even when nothing changed. The parse cache keeps unchanged files from being read again,
but the checking and rebuilding grow with the whole history, not with what is new.

### Done when

A refresh's cost is measured on a large history, and if it is noticeable, a refresh where no
transcript changed does no transformation work, and one where a transcript changed rebuilds only
what depends on it. Output is unchanged.

### Current state

Not measured. The history this was written on (227 MB) shows no visible lag.

### Dependencies and open questions

- Whether it is worth doing at all depends on the measurement; record it here either way.
- Caching in the transformation layer must keep its rule that loaded data is never mutated
  (`docs/ARCHITECTURE.md`).

### Next actions

- [ ] Time one refresh (`tailFrame` plus everything it calls) on a large copied history.
- [ ] If it matters: skip the rebuild when no transcript's size or modification time changed.

### Verification

`pnpm test` passes, the first `--tail` frame is byte-for-byte the same as before on a snapshot of
real transcripts, and the timing is recorded in this entry.
