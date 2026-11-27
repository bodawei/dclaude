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

| ID  | Status | Project                                         |
| --- | ------ | ----------------------------------------------- |
| P0  | done   | Usage report, CSV, `--tail` and costs           |
| P1  | active | Tests, lint, format and CI                      |
| P2  | next   | Separate `--tail` drawing from terminal I/O     |
| P3  | idea   | Small cleanups: shared cost sum, duplicates     |
| P4  | onhold | Split `bin/dclaude.mjs` into reading and output |

## P0: Usage report, CSV, `--tail` and costs

### Goal

A local CLI that reads Claude Code transcripts and shows where tokens and money went, per
project, session, turn and API call.

### Done when

The Markdown and CSV reports, `--summary`, `--no-calls`, `--hide-worktrees` and `--tail` (with
per-turn and per-project costs from `~/.dclaude_costs`) work against a real `~/.claude/projects`.

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

**Active 2026-11-27.** The suite in `test/dclaude.test.mjs` covers transcript parsing (message-id
de-duplication, turn boundaries, flags), the price file, `costOf` (tiers, multipliers, unknown
models), `tailLines`, `projectLabel`'s shrinking stages, `groupWorkspaces`, project loading with
subagents, and two CLI runs (CSV output and an unknown option). `oxlint` and `oxfmt` are set up
and the code base passes both. The workflow is written but has not run on GitHub yet.

### Next actions

- [ ] Merge the PR and confirm the check runs and passes on GitHub.
- [ ] Make the check required for `main` in the repository settings (a human step).

### Verification

The three commands above pass locally, and the PR's `Check` job is green.

## P2: Separate `--tail` drawing from terminal I/O

### Goal

`tail()` mixes loading data, working out column widths, building lines and handling the
terminal. Move the middle part into a pure function, such as
`tailScreen(turns, rates, { rows, cols, now })`, that returns the lines, and leave `tail()` with
the refresh loop, the screen writes and the `q` key.

### Done when

The header, the column layout and the narrow-screen behaviour are covered by tests that call the
pure function at several widths, with no pseudo-terminal.

### Current state

Not started. `tailLines` and `projectLabel` are already pure and tested; the rest of the layout
is still inside `tail()`.

### Next actions

- [ ] Extract the function and move the existing behaviour across unchanged.
- [ ] Add width tests for the header, the turn lines and the project lines.

### Verification

`pnpm test` passes, and `--tail` looks the same as before at 120, 80 and 40 columns.

## P3: Small cleanups

### Goal

Remove duplicated logic found in the review:

- "Total cost, or unknown if any part is unknown" appears in `tailLines` and in the `--tail`
  header; give it one helper.
- `secs` and `secsNum` differ only in what they show for a missing time.
- Workspace grouping (`matchWorkspace`, `groupWorkspaces`, `loadAll`) sits in the main section
  but belongs with discovery.

### Done when

Each item has one implementation, behaviour is unchanged, and the tests still pass.

### Current state

Not started.

### Verification

`pnpm test`, lint and format check pass; the Markdown and CSV reports are unchanged for the same
input.

## P4: Split `bin/dclaude.mjs` into reading and output

### Goal

Put reading (parsing, costs, discovery) and output (Markdown, CSV, `--tail`) in separate
modules, with `bin/dclaude.mjs` as a thin entry point.

### Current state

**On hold.** One file is still easy to read and install. Revisit when the file grows well past
its current size or when P2 makes the `--tail` code large enough to want its own module.

### Dependencies and open questions

Depends on P2. `files` in `package.json` would need to include the new module directory.
