# Module brief

A module is an implementation-level unit: larger than a function, smaller than the program. It
owns a capability end-to-end and exposes a contract to the rest of the program. The human designs
the boundary; the agent owns the implementation inside it.

In dclaude a module is usually one file under `lib/`, in one of three layers: loading,
transformation or presentation. Say which layer in the brief.

Write the brief before the code. If the brief cannot be written clearly, the module is not ready
to implement.

## Template

```markdown
# Module: [name]

## Purpose

The capability this module owns, in one or two sentences. What user or system outcome depends on
it?

## Capability served

The product or domain capability this module contributes to. Capabilities are language-agnostic;
a capability may be delivered by more than one module.

## Where it lives

The file under `lib/` that holds it, and its layer.

## Owns

- The responsibilities and data this module is the source of truth for.

## Does not own

- Nearby responsibilities that belong elsewhere. This is often the most useful section.

## Public interface

The contract other modules may use: function signatures and the shapes they take and return, or
for a user-facing module, the options and output format. Include error cases. Internal helpers
are not part of the contract.

## Inputs and state

What the module reads (transcripts, the price file, terminal size, the clock) and any state it
keeps between calls, such as the parse cache `--tail` uses.

## Dependencies

- Allowed dependencies: modules, libraries, or services this module may use.
- Forbidden dependencies: things it must not reach into.
- Direction: which modules may depend on this one, and which must not.

## Error model

What can fail, what the user sees, and what is skipped, shown as `?`, or reported with an exit
code. Do not invent a new error shape if the codebase already has one.

## Performance and limits

Expected input size (a large `~/.claude/projects`), per-refresh cost in `--tail`, and what happens
at the limits (a narrow terminal, a huge transcript).

## Tests and acceptance

- Unit tests for the module's contract and edge cases.
- Integration tests at the module boundary.
- The acceptance criteria that must pass before the module is considered done.
- The fixtures the tests need so they never read the real `~/.claude`.

## Migration and rollout

If the module replaces existing code, say how the change is sequenced and what can be removed
after it lands.

## Open questions and decisions

What is unresolved, who owns it, and what was already decided. Record the reason, not just the
choice.

## Definition of done

A short checklist: contract implemented, tests passing, `README.md` and
`--help` updated, no forbidden dependencies, and the acceptance criteria met.
```

## Rules of thumb

- One capability per module. If the purpose needs "and", it may be two modules.
- Contract first, implementation second. The agent should not discover the public interface while
  writing the code.
- Decompose by capability, not by technical layer.
- A module may have internal layers, such as pure logic and I/O. Other modules use only its
  public interface.
- Keep I/O at the edge so the module's logic can be tested with plain values.
- Start coarse. Split when inputs, change cadence, or failure modes diverge.
- The human owns the boundary and acceptance. The agent owns the code and tests inside it.
- One module per implementation session where possible. If a change crosses a boundary, propose a
  contract change first.
- Do not add a runtime dependency to make a boundary easier; Node's built-ins are the budget.
