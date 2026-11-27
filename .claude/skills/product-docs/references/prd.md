# docs/PRD.md

## Purpose

The product requirements document is the source of truth for **who the product is for, what it
must do, and how we will know it works**. The one-pager sets direction; the PRD makes it
precise.

Keep product concerns and implementation concerns distinct. The PRD may include a module map and
module briefs, but it should not become a code tour.

## Outline

### 1. Summary

Two or three paragraphs. Link to `docs/ONE_PAGER.md`; do not repeat it.

### 2. Target users and personas

Who is the primary user? Who is explicitly not the user for v1? What do they already know, what
tools do they use, and what constraints shape their day?

### 3. Problem and opportunity

What is painful today? What is the cost of the status quo? Why is now the right time?

### 4. Value proposition and positioning

One sentence: "For ___ who ___, this is ___ that ___." What alternatives exist, and why is this
different?

### 5. Goals, non-goals, and success metrics

- Goals for v1.
- Explicit non-goals.
- Success signals: activation, time to first result, retention, reliability, or whatever
  actually indicates the core flow works.

### 6. Jobs-to-be-done

The handful of jobs the product must do well. Phrase them as outcomes, not features.

### 7. Primary flows

Describe the journeys end to end:

- The first run: installing, pointing it at `~/.claude/projects`, reading the first report.
- The everyday uses: checking what a session or project cost, exporting CSV, watching `--tail`.
- Setting up and correcting a price file.
- Missing, partial, or malformed input: no transcripts, a line cut off mid-write, an unknown
  model, a bad price file.

For each flow, name the entry point, the steps, the success state, and the failure paths.

### 8. Functional requirements

Group requirements by flow. Use stable IDs if the team tracks them. Each requirement should be
testable and should say what the user can do or observe.

### 9. Output principles and states

The principles that should guide trade-offs (for example: never guess a cost; show `?` instead).
Then the states every output must handle: no data, partial data, unknown values, and a terminal
too narrow for everything.

### 10. Data and privacy

What data the tool reads, where it lives, and what it must never do with it. dclaude reads local
transcripts and a price file and writes only to stdout; say so, and say what would change that.

### 11. Non-functional requirements

Performance on a large `~/.claude/projects`, refresh cost in `--tail`, supported Node versions,
and platform constraints. Keep them concrete enough to verify.

### 12. Module map

The implementation is designed as modules: units larger than a function, smaller than the
program, independently testable and as independent as practical. The human designs the
boundaries; the agent implements inside them.

Modules are logical units; a file is the physical unit that holds them. Capabilities are the
product outcomes that modules deliver. Use the words distinctly.

| Module | Capability served | Where it lives | Public interface | Inputs | Depends on | Not responsible for |
| ------ | ----------------- | -------------- | ---------------- | ------ | ---------- | ------------------- |
|        |                   |                |                  |        |            |                     |

Rules for the map:

- Organize by capability or domain, not by technical layer.
- A module may have internal layers (pure logic, I/O), but other modules only use its public
  interface.
- Shared helpers (time and number formatting) are dependencies of capability modules, not the
  top-level decomposition.
- Start coarse. Split a module when its inputs, change cadence, or failure modes diverge from its
  neighbors.

### 13. Module briefs

Each module gets a brief using `references/module-brief.md`. Store it as
`docs/modules/<module>.md` (or in a PRD appendix if the project is small) and link it from the
module map. The brief is the handoff unit for implementation and the thing a review is checked
against.

### 14. Dependencies, risks, and open questions

What could block the work, what is uncertain, and what decision is still open. Record who owns
each open question.

### 15. Release criteria

What must be true before v1 ships? Include the flows that must work, the checks that must pass,
and the known limitations that are acceptable.

### 16. Decision log

A short chronological list of product and architecture decisions with dates and reasons. This is
where "why did we do it this way?" gets answered without archaeology.

## Writing rules

- Describe flows before screens.
- Separate "what the user needs" from "how we will build it".
- Prefer outcomes and acceptance criteria over adjectives.
- Link to the one-pager, module briefs, and roadmap instead of repeating them.
- When a requirement changes, update the flow and the acceptance criteria together.
