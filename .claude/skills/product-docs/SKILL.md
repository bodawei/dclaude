---
name: product-docs
description: Use when creating, revising, or reviewing dclaude product documentation such as docs/ONE_PAGER.md, docs/PRD.md, docs/ROADMAP.md entries, or module briefs, including questions like "what should this look like again?" and requests for examples. Covers the Amazon-style one-pager, the product requirements document (users, value proposition, flows, requirements, module map), and the human/AI division of labor where the human designs modules and the agent owns their implementation.
---

# Product documentation

This repository separates product intent from execution. Keep the documents in their lanes. Each
one answers a different question. Collapsing them makes the product follow the code instead of
the other way around.

| Document            | Question it answers                                 | Owner                     |
| ------------------- | --------------------------------------------------- | ------------------------- |
| `docs/ONE_PAGER.md` | Why does this exist, and what does it feel like?    | Human product owner       |
| `docs/PRD.md`       | Who is it for, what must it do, and how do we know? | Human, with agent support |
| `docs/ROADMAP.md`   | What are we doing next, and in what order?          | Derived from the PRD      |
| `README.md`         | How do I install, run and develop it?               | Engineering               |
| `AGENTS.md`         | How should an agent work in this repository?        | Engineering               |

Today only `README.md`, `AGENTS.md` and `docs/ROADMAP.md` exist. The roadmap was seeded from a
code review, not from a PRD, and says so.

The product owner writes the first draft of the one-pager. The agent may edit it for clarity but
must not invent product direction. When the product intent is unclear, ask; do not fill the gap
with plausible-sounding copy.

## docs/ONE_PAGER.md: direction and feeling

An Amazon-inspired "working backwards" press release: roughly 500 words, written in prose as if
the product already exists. It should be evocative and customer-facing.

It answers: **what changes for the person using Claude Code, and why would they care?**

It contains a concrete problem scene, the promise, the experience, a quote, and how to get it. It
does not contain personas tables, requirements, architecture, roadmaps, or an option list.

See `references/one-pager.md` for the shape, checklist, and examples.

## docs/PRD.md: the product source of truth

The PRD is where the product concerns live: target users, value proposition, jobs-to-be-done,
flows, requirements, success signals, risks, and the module map. It links to the one-pager instead
of repeating it.

Write it around **flows and outcomes**, not an option list. A reader should be able to trace the
first run, the everyday use (checking a session's cost, watching `--tail`), and what happens when
input is missing or malformed.

See `references/prd.md` for the full outline.

## The module model

A **module** is an implementation-level unit: larger than a function, smaller than the program. A
capability can be built from one or more modules. Modules should be independently testable and,
as much as practical, independent of each other.

This is the unit of collaboration: the human designs the module boundary and contract, and the
agent owns the implementation inside it.

### Vocabulary

Use these words distinctly:

| Word           | Means                                                                          | Example                                    |
| -------------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| **Capability** | A product outcome the tool provides. It is realized by one or more modules.    | "price a turn", "watch usage live"         |
| **Module**     | The logical design unit. It owns a capability (or part of one) and a contract. | transcript parsing, pricing, `--tail` view |
| **File**       | The physical unit that holds one or more modules.                              | `bin/dclaude.mjs`                          |
| **Layer**      | Internal organization inside a module. Not the main axis.                      | pure layout vs. terminal I/O in `--tail`   |

dclaude is one file today, so its modules are the `// ---------- name ----------` sections of
`bin/dclaude.mjs`: parsing, costs, discovery, formatting, CSV, tail mode and main. A module does
not need its own file to be real; it needs a clear contract and tests at that contract. Splitting
into files is roadmap item P4 and is on hold.

### Modules, layers, and capabilities

- Decompose by **capability**, not by technical layer. "Pricing" owns reading the price file and
  `costOf`; it is not split into "file reading" and "math" modules used by everything.
- Layers are useful **inside** a module. The `--tail` view has a pure layout layer
  (`tailLines`, `projectLabel`) and a terminal layer (`tail()`). Its contract is what the user
  sees, not each internal function.
- Start coarse. Split when a real seam appears: different inputs, different change cadence,
  different failure modes, or a boundary worth testing on its own.
- Keep pure logic and I/O apart, so a module can be tested without a terminal or a real
  `~/.claude`.
- The contract comes before the code. Write the inputs, outputs, error behaviour, tests and
  acceptance criteria first.

See `references/module-brief.md` for the module brief template.

## docs/ROADMAP.md: execution sequencing

The roadmap is a consequence of the PRD, not a substitute for it. It sequences work, tracks
status, and records the current state honestly.

One-session tasks belong in `.context/todos.md` or the PR description, never in the roadmap.

See `references/roadmap.md` for the entry template and status rules.

## Working with an agent

The division of labor is deliberate:

- **Human:** product direction, priorities, the one-pager, module boundaries, contracts, and
  acceptance.
- **Agent:** implementation inside an agreed module, tests, and documentation updates.

Practical rules:

- Do not let the agent invent product direction. If the documents are silent on a product
  decision (a new option, a new column, what a cost of `?` should mean), ask.
- If a request changes scope, update the PRD first (once it exists), then the roadmap, then the
  code. If it changes a module boundary or contract, propose that change explicitly before
  implementing it.
- Keep implementation work inside one module per session where possible.
- Review at the seams: contracts, error handling, and tests.
- Record decisions and open questions where the next person will look: the PRD for product
  decisions, module briefs for implementation decisions, and the roadmap only for sequencing.

## Workflow

1. Read the one-pager, PRD and roadmap (whichever exist), relevant module briefs, and the code you
   are changing.
2. Classify the request: product direction, requirements, module design, implementation, or
   sequencing.
3. For a one-pager request: do not draft the product vision unless the human asks. Ask the
   product questions, then edit for clarity and voice.
4. For a PRD request: use the reference template, keep product concerns separate from
   implementation detail, and include a module map.
5. For a module request: write or revise the module brief and contract before coding.
6. For a roadmap request: derive the sequence from the PRD (or, until it exists, from what the
   human asked for) and update status, current state, and next actions.
7. For code: implement inside the module, add tests, and run the repository checks.

## Anti-patterns

- Turning the one-pager into an option list or requirements document.
- Using the PRD as a roadmap, or the roadmap as the product spec.
- Splitting modules by technical layer and calling the result decoupled.
- Splitting the single file into many files before the module contracts are clear.
- Letting the agent invent the product vision or silently expand scope.
- Letting implementation cross module boundaries without an explicit contract change.
- Duplicating the same content across documents instead of linking to the source of truth.

## References

- `references/one-pager.md`: press-release shape, voice, and review checklist.
- `references/prd.md`: full PRD outline, including the module map.
- `references/module-brief.md`: contract-first module template.
- `references/roadmap.md`: status rules and project entry template.
