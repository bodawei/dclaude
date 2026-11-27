# docs/ROADMAP.md

## Purpose

The roadmap sequences work derived from the PRD. It answers **what are we doing next, and in what
order?** It is not the product definition, and it is not a feature wish list.

The product source of truth is `docs/ONE_PAGER.md` plus `docs/PRD.md`, once they exist. The
roadmap points at them.

## Status model

`idea` → `onhold` → `next` → `active` → `blocked` → `done`

- `idea`: captured, not committed.
- `onhold`: deliberately deferred. Say why and what would unblock it.
- `next`: the next thing to work on.
- `active`: currently being worked on.
- `blocked`: waiting on a decision, dependency, or external event. Name it.
- `done`: verification steps passed.

Only mark something `done` after its verification steps pass.

## Project entry template

```markdown
## Pn: Short project name

### Goal

What outcome this project exists to produce, in one paragraph.

### Done when

The observable conditions that mean the project is finished. Prefer flows and checks over
activity lists.

### Current state

What exists now, what works, what is missing, and the date of the last meaningful update. Keep
this honest; future agents will trust it.

### Dependencies and open questions

What must be decided or delivered first. Link to the PRD section or module brief.

### Next actions

- [ ] The next concrete step.
- [ ] The step after that.

### Verification

The commands or manual checks that must pass before this moves to `done`.
```

## Deriving the roadmap from the PRD

1. Read the PRD's primary flows and module map.
2. Identify the smallest sequence that makes the core flow work end to end.
3. Sequence by risk and dependency, not by layer.
4. Mark anything that depends on an unresolved product decision as `onhold` or `blocked`.
5. Keep one-session tasks out of the roadmap; they belong in `.context/todos.md` or the PR
   description.
6. When the product intent changes, update the PRD first, then re-derive the roadmap.

## Rules

- A project should have one clear outcome. If it needs "and", consider splitting it.
- Do not use the roadmap to make product decisions. Link to the PRD.
- Do not preserve stale projects for appearance. Rewrite or remove them.
- Update `Current state` and `Next actions` at the end of any session that changes them.
- Keep the overview table and the project sections consistent.
- The current entries were seeded from a code review on 2026-11-27, not from a PRD. P0 is
  historical. Re-derive them once a PRD exists.
