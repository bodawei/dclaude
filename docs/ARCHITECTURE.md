# Architecture

dclaude is three layers that run in order: **load** the files, **transform** the data, and
**present** it as one output. Each layer has its own folder under `lib/`, and every file's header
comment says which layer it belongs to. `bin/dclaude.mjs` is the command line that runs them.

This is the canonical description of that split: what each layer does, what it may
not do, how data moves through it, and where a new change belongs. The data shapes themselves
are documented once, in the header comments of `lib/load/transcripts.mjs` and
`lib/transform/projects.mjs`.

## The layers

```text
bin/dclaude.mjs              command line: options, --help, runs the layers, prints, exits
lib/
├── load/                    LAYER 1: LOADING
│   ├── transcripts.mjs      .jsonl transcripts -> RawProject[] (sessions, subagents, turns, calls)
│   └── prices.mjs           ~/.dclaude_costs -> rates (dollars per token)
├── transform/               LAYER 2: TRANSFORMATION
│   ├── projects.mjs         RawProject[] -> Project[]; Project[] -> TurnEntry[]
│   └── costs.mjs            costOf(calls, rates), sumCosts(costs)
└── present/                 LAYER 3: PRESENTATION
    ├── common.mjs           helpers more than one presenter uses: fmtTime, secs, money, fit, ...
    ├── markdown.mjs         markdownReport(projects, options) -> text      (default output)
    ├── csv.mjs              csvReport / csvSummary(projects) -> text       (--csv)
    └── tail.mjs             tailFrame(turns, rates, size) -> lines;        (--tail)
                             runTail() drives the terminal
```

### 1. Loading: what is on disk?

Reads files and decodes them into plain data. It decodes what the file format forces and nothing
more. Claude Code writes one transcript record per content block, each repeating the response's
usage, so turning records into calls (one per message id, with the last usage seen) is decoding
and belongs here. A line cut off mid-write is skipped here too.

It does not add anything up, drop anything, merge anything, or choose a name. A project folder
whose sessions made no API calls is still returned; deciding that it doesn't count is a
transformation.

### 2. Transformation: what does it add up to?

Turns the raw data into the model every output works from, the same for all of them:

- start and end times, token totals and call counts for sessions, subagents and projects;
- session and subagent ids, and the workspace a session ran in;
- sessions and projects without API calls dropped;
- worktree and Conductor workspace folders merged into their project (`--hide-worktrees`);
- two folders that recorded the same `cwd` told apart;
- each call's cost from the price table, or `null` when it can't be known;
- every turn across all projects, newest first, for `--tail`.

Nothing here knows how the result will be shown: no strings meant for a reader, no `?` for an
unknown cost, no widths.

### 3. Presentation: how is it shown?

One file per output. Each one prepares what it needs from the model (for example, `--tail` turns
a `TurnEntry` into a row with `claude-` dropped from the model name) and renders it. Presenters
return text or lines. Only `bin/dclaude.mjs` and `runTail()` write to the terminal.

Helpers that more than one presenter needs live in `common.mjs`. A helper only one presenter uses
stays in that presenter's file.

## How data moves

```text
                     load                     transform                    present
paths ──▶ loadPaths() ──▶ RawProject[] ──▶ buildProjects() ──▶ Project[] ──▶ markdownReport()
                                                                  │      └─▶ csvReport()
                                                                  │          csvSummary()
                                                                  └─▶ allTurns() ──▶ TurnEntry[] ──▶ tailFrame()
~/.dclaude_costs ──▶ loadCosts() ──▶ rates ─────────────────────────┘ (costOf)
```

For the Markdown and CSV reports this runs once. For `--tail`, `runTail()` calls back into the
whole chain every second. Re-reading every transcript each time would be too slow, so the loading
layer caches each parsed transcript and parses it again only when its size or modification time
changes.

## Rules

These keep the layers apart. A change that needs to break one should change this document first.

| Rule                                                                                                                                                                                         | Why                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Imports point down only. Presentation may import transformation; transformation imports nothing from presentation; loading imports from neither.                                             | Each layer can be read, tested and changed without the ones above it.                                 |
| Loading and transformation never print, read the clock, or exit. Loading throws an `Error` (for a bad price file, with `path` set), and `bin/dclaude.mjs` reports it and sets the exit code. | Errors and output stay in one place, and both layers can be tested with plain values.                 |
| Nothing mutates loaded data. Transformation returns new objects.                                                                                                                             | `--tail` reuses parsed transcripts from the cache; a change to one would carry into the next refresh. |
| A derived value that more than one output needs belongs in transformation, not in a presenter.                                                                                               | Otherwise the outputs compute it separately and drift apart.                                          |
| A new output is a new file in `lib/present/`.                                                                                                                                                | Outputs stay independent; adding one cannot break another.                                            |
| Each file lists its exports in one `export { … }` at the end.                                                                                                                                | The file's interface to the other layers is in one place.                                             |

## Where a change goes

| Change                                                   | Where                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Claude Code adds a field to its transcripts that we want | `lib/load/transcripts.mjs`, onto the call or turn; then wherever it is used                                |
| A new price-file key                                     | `lib/load/prices.mjs` to read it, `lib/transform/costs.mjs` to use it                                      |
| A new total, count or grouping                           | `lib/transform/projects.mjs`                                                                               |
| A new column in one output                               | That presenter only, if the value is already in the model; otherwise add the value in transformation first |
| A new output format                                      | A new file in `lib/present/` and a flag in `bin/dclaude.mjs`                                               |
| A new option that filters data (by date, by project)     | `lib/transform/`, passed in from `bin/dclaude.mjs`, so every output gets it                                |

Any change to an option or a column also updates `README.md` and the `--help` text in
`bin/dclaude.mjs`.

## Tests

The tests follow the layers: `test/load.test.mjs`, `test/transform.test.mjs` and
`test/present.test.mjs` call each layer's functions directly, and `test/cli.test.mjs` runs the
command. Fixtures are small `.jsonl` files written to a temporary folder by `test/helpers.mjs`;
no test reads the real `~/.claude`. `runTail()` needs a real terminal and has no automated test;
`tailFrame()` covers the layout it draws.

## Decisions

- **2026-11-27: three layers, not two.** A split into "reading" and "output" (roadmap P4 as first
  written) would have left the totals, merging and costs inside one or the other. Those are
  shared by every output and depend on none of them, so they are a layer of their own.
- **2026-11-27: de-duplication by message id is loading, not transformation.** It undoes how
  Claude Code writes the file, rather than deriving something new. Every consumer needs it, and
  without it the raw data would count each response several times.
