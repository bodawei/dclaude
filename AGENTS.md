# Agent notes

This repository is **dclaude**, a Node.js CLI that reports Claude Code token usage
and cost from the session transcripts in `~/.claude/projects`. It has no runtime dependencies;
`oxlint` and `oxfmt` are the only dev dependencies.

## Read first

- `README.md`: what the tool does, its options and columns, and the development commands.
- `docs/ROADMAP.md`: multi-session projects and their current state.
- `bin/dclaude.mjs`: the command line. Its `--help` text is part of the interface; keep it in
  step with `README.md`.
- The header comment of each file under `lib/`, which says which layer it belongs to.

## Project tracking

- `docs/ROADMAP.md` is the source of truth for multi-session projects.
- Read it before starting work. If a request does not fit an existing item, add an item or ask;
  do not silently expand scope.
- At the end of a session, update only what actually changed: status, current state, and next
  action. Mark an item `done` only after its verification steps pass.
- One-session tasks belong in `.context/todos.md` or the PR description, never in
  `docs/ROADMAP.md`. `.context/` is local to a workspace and is not committed.

## Product documentation

- dclaude has no one-pager or PRD yet. If one is written, product direction goes in
  `docs/ONE_PAGER.md` and requirements in `docs/PRD.md`, and the roadmap is derived from them.
- Load the `product-docs` skill before creating or revising those documents, a module brief, or
  roadmap entries.
- Load the `tech-docs` skill before writing explanations of how the tool works, such as how a
  transcript becomes turns and calls.

## Reporting back

- Never report back that you did what was asked. When the change matches the request, a bare
  confirmation is enough; do not restate text you just wrote into a document, because the user can
  read it there.
- Assume a requested change was made. Do not narrate routine changes, list every file touched, or
  repeat the request back.
- Keep the final message to what the reader needs to decide or do next: concerns, questions,
  deviations, blockers, or a one-line confirmation when none of those apply.
- State deviations explicitly: what changed from the request and why.
- Report failed, skipped, or surprising verification. Do not inventory passing checks unless the
  user asked for them.
- Prefer a form like "Added to `<path>`. One note: …" over a change log.

## Commands

| Purpose             | Command                                                              |
| ------------------- | -------------------------------------------------------------------- |
| Install dev tools   | `pnpm install`                                                       |
| Run the CLI         | `node bin/dclaude.mjs [args]`                                        |
| All tests           | `pnpm test`                                                          |
| One test file       | `node --test <path>`                                                 |
| Lint                | `pnpm lint`                                                          |
| Format touched file | `pnpm exec oxfmt <files>`                                            |
| Format check        | `pnpm format:check`                                                  |
| What CI runs        | `pnpm exec oxlint --deny-warnings && pnpm format:check && pnpm test` |

Package manager: pnpm 10. Use `pnpm-lock.yaml`; do not add an npm lockfile. The published
package (`files` in `package.json`) is `bin/`, `lib/` and `README.md` only, so dev tooling
never ships.

## Architecture

The program is three layers, one folder each, run in order by `bin/dclaude.mjs`:

```text
├── bin/dclaude.mjs                   Command line: options, help text, runs the three layers
├── lib/load/                         Layer 1, loading: read files, decode them, nothing else
│   ├── transcripts.mjs               .jsonl transcripts -> projects, sessions, turns, calls
│   └── prices.mjs                    ~/.dclaude_costs -> per-token rates
├── lib/transform/                    Layer 2, transformation: independent of any output
│   ├── projects.mjs                  totals, ids, empty data dropped, workspaces merged, turns
│   └── costs.mjs                     pricing calls; null when a cost can't be known
└── lib/present/                      Layer 3, presentation: one file per output
    ├── common.mjs                    shared helpers: times, secs, numbers, money, fit
    ├── markdown.mjs                  the Markdown report (default)
    ├── csv.mjs                       --csv
    └── tail.mjs                      --tail: tailFrame() lays out a screen, runTail() drives it
```

1. **Loading** (`lib/load/`) reads files and decodes them into plain data. It decodes what the
   file format forces (several records per API response, so calls are de-duplicated by message
   id) and nothing more: no totals, no filtering, no merging, no names.
2. **Transformation** (`lib/transform/`) turns that into the model every output uses: totals,
   ids, empty sessions and projects dropped, worktrees merged (`--hide-worktrees`), duplicate
   project names told apart, costs, and every turn newest first. Nothing here knows how the
   result will be shown.
3. **Presentation** (`lib/present/`) prepares and renders one output per file. Each presenter
   returns text or lines; only `bin/dclaude.mjs` and `runTail()` write to the terminal.
   Helpers used by more than one presenter go in `common.mjs`.

Rules that keep the layers apart:

- Imports point down only: presentation may import transformation, transformation may import
  nothing from presentation, and loading imports from neither.
- Loading and transformation never print, read the clock, or exit. Loading throws an `Error`
  (with `path` set for a bad price file), and `bin/dclaude.mjs` reports it and sets the exit
  code.
- Nothing mutates the loaded data: `--tail` reloads every second and reuses parsed
  transcripts from a cache. Transformation returns new objects.
- A new output is a new file in `lib/present/`. A new derived value that more than one output
  needs belongs in `lib/transform/`, not in a presenter.
- Each file lists its exports in one `export { … }` at the end. `bin/dclaude.mjs` runs `main()`
  only when it is the command being executed.
- The tool only reads local files. Do not add network access, telemetry, or writes outside
  stdout.
- Node 21 or later (`engines` in `package.json`). Use only `node:` built-ins; do not add a runtime
  dependency.

## Known pre-existing failures

None. `pnpm test`, `pnpm lint` and `pnpm format:check` are expected to be clean, with no lint
warnings. If one is not, treat it as a regression rather than a baseline.

## Code style

- `oxfmt` (`.oxfmtrc.json`) is authoritative for formatting and import order (`sortImports` owns
  grouping and sorting), including Markdown. Do not hand-format around it; run
  `pnpm exec oxfmt <files>` and let it decide.
- `oxlint` (`.oxlintrc.jsonc`) is authoritative for everything else. It runs the stock rules
  with the `correctness`, `suspicious` and `perf` categories and the `unicorn`, `oxc`, `import`
  and `node` plugins. CI fails on warnings as well as errors.
- Export placement and blank-line conventions are covered by the `javascript-formatting` skill.
  Load it before writing or reviewing JavaScript.
- Transcript records are untrusted input: a field may be missing or a line may be cut off
  mid-write. Default missing values instead of assuming them.
- Do not add a dependency for something Node already does.

## Tests

- Tests live in `test/**/*.test.mjs` and run under the built-in `node:test` runner
  (`pnpm test`).
- Build transcripts as small `.jsonl` fixtures in a temporary directory; never read the real
  `~/.claude/projects` from a test.
- One test file per layer (`load`, `transform`, `present`) plus `cli.test.mjs`, which runs
  `bin/dclaude.mjs` with `execFileSync`. Shared fixtures are in `test/helpers.mjs`.
- `--tail` layout is tested through `tailFrame()` at fixed sizes. `runTail()` (alternate
  screen, refresh, keys) needs a real terminal and has no automated test.

## Definition of done

- `pnpm test` passes.
- `pnpm exec oxlint --deny-warnings` reports nothing.
- `pnpm format:check` passes.
- `README.md` and the `--help` text describe any option or column you changed.
- `docs/ROADMAP.md` is updated if the work changed a project's state.
- Commit messages are a short imperative sentence (`Show the latest turn time on --tail project
  lines`).
- PRs target `main`. CI (`.github/workflows/check.yml`) must pass.
