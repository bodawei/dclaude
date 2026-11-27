# Agent notes

This repository is **dclaude**, a single-file Node.js CLI that reports Claude Code token usage
and cost from the session transcripts in `~/.claude/projects`. It has no runtime dependencies;
`oxlint` and `oxfmt` are the only dev dependencies.

## Read first

- `README.md`: what the tool does, its options and columns, and the development commands.
- `docs/ROADMAP.md`: multi-session projects and their current state.
- `bin/dclaude.mjs`: the whole program. Its `--help` text is part of the interface; keep it in
  step with `README.md`.

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
package (`files` in `package.json`) is `bin/` and `README.md` only, so dev tooling never ships.

## Architecture

- `bin/dclaude.mjs` is one ES module, organized in sections marked `// ---------- name ----------`:
  parsing (transcript records to turns and calls), costs (the price file and `costOf`),
  discovery (finding projects, sessions and subagents on disk), formatting and CSV (the
  Markdown and CSV reports), tail mode (`--tail`), and main (workspace grouping, option
  handling).
- The file runs `main()` only when it is the command being executed, so tests can import it.
  Anything a test needs is listed in the `export { … }` statement at the end of the file.
- Keep pure logic (parsing, pricing, layout such as `tailLines` and `projectLabel`) separate from
  I/O (`readFileSync`, `process.stdout`, `process.exit`), so it can be tested without a terminal
  or a real `~/.claude`.
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
- Test pure functions directly. Test option handling and output by running `bin/dclaude.mjs`
  with `execFileSync`.
- `--tail` drawing is only partly covered (`tailLines`, `projectLabel`); the rest of `tail()`
  needs a terminal. Do not claim coverage the repo does not have.

## Definition of done

- `pnpm test` passes.
- `pnpm exec oxlint --deny-warnings` reports nothing.
- `pnpm format:check` passes.
- `README.md` and the `--help` text describe any option or column you changed.
- `docs/ROADMAP.md` is updated if the work changed a project's state.
- Commit messages are a short imperative sentence (`Show the latest turn time on --tail project
  lines`).
- PRs target `main`. CI (`.github/workflows/check.yml`) must pass.
