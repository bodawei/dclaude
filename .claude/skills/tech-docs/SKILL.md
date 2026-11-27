---
name: tech-docs
description: Use when writing, restructuring, or reviewing technical documentation such as API or protocol walkthroughs, architecture and design notes, reference pages, runbooks, and how-to guides, including requests like "explain how this works", "turn this into documentation", "where should this go", "restructure this doc", or "review this for clarity". Covers document shapes, the operation-across-an-API-trace structure, how to present data structures, provenance and encoding rules, and a review checklist. Do not use for product direction documents (one-pager, PRD, roadmap); use the product-docs skill for those.
---

# Technical documents

A technical document exists to answer the questions a reader has _while doing something else_:
where does this value come from, what contains what, when does this happen, and which layer owns
this fact. Prose that sounds authoritative while leaving those questions open is worse than a
shorter document that answers them.

This skill covers documents that explain how a system works: reference pages, API and protocol
walkthroughs, architecture notes, runbooks, and how-to guides. Product intent lives elsewhere.

In dclaude the usual subject is a data path: how Claude Code's transcript records become turns,
calls, costs, and lines on screen. Treat each hop (API to Claude Code, Claude Code to the
`.jsonl` file, the file to dclaude's parser, the parser to a report) as a message in the trace
below. The questions that matter most are which side produced a field and whether a number has
been de-duplicated, summed, or estimated.

## Pick the shape before writing

Each shape answers a different question. Mixing them in one section is the most common reason a
technical document becomes hard to follow.

| Shape                  | Answers                        | Typical content                                 |
| ---------------------- | ------------------------------ | ----------------------------------------------- |
| Reference              | "What is this thing?"          | fields, options, defaults, errors, constraints  |
| Operation walkthrough  | "What happens, in what order?" | numbered messages, payloads, state changes      |
| Protocol or mechanism  | "How does it work underneath?" | actors, data, guarantees, trust boundaries      |
| Design or architecture | "Why is it built this way?"    | boundaries, ownership, alternatives, trade-offs |
| How-to or runbook      | "How do I do this?"            | preconditions, steps, verification, recovery    |

A walkthrough that stops to justify a design decision loses its thread; link to the design note.
A design note that narrates every request is a walkthrough in disguise.

## Operation across an API trace

This is the shape most often written badly, because a correct sequence of steps can still leave
the reader unable to answer "where did this value come from?". The rules below are about making
the trace answer provenance questions.

### Start with the backbone

Open with three to five sentences that state the whole operation: what asks for what, what does
the work, and what the outcome is. No data structures, no field names, no edge cases. Then say
that the numbered messages are that backbone expanded.

Reason: the reader needs a skeleton to hang detail on. It also lets someone stop after one
paragraph when that is all they needed.

### Number the messages, not the side effects

One arrow in the diagram is one numbered item, and the diagram and the prose share the same
numbers in the same order. Server work that happens between two messages belongs inside the arc
that causes it, not as a separate item.

Reason: a diagram and a list numbered by different principles force the reader to reconcile two
models of the same operation.

### Name direction and payload in the heading

Use "Claude Code → transcript: one `assistant` record per content block", not "the parser reads
usage". For HTTP, state method and path, and say explicitly whether there is a body ("no body",
"body is `{}`"). For a file, say what record type is written and how often.

Reason: the first question on reaching a step is what crosses the wire.

### Show structures as structures

Render data as a literal: JSON for HTTP bodies, TypeScript for client objects, or a byte-layout
block for binary formats. A field table next to the literal is fine when there are many fields.
Avoid prose enumerations like "it has a, b, and c", and avoid fake JSON for things that are not
JSON.

Reason: a prose list makes the reader assemble the shape in their head, and it hides nesting.
Questions like "is this field inside that one?" are answered by a literal and not by a sentence.

### Give every field a producer

For each value, say who creates it and when: the client, the browser, the server, the database,
the OS, a library, a third-party service. If a field is copied, say from where.

Reason: provenance is the question that catches real errors. If you cannot state who produces a
field, the document is not yet understood well enough to publish.

### Name the encoding at each hop

Say whether a value is raw bytes, an `ArrayBuffer`, a base64 or base64url string, a JSON object,
or a stored row, and where the conversion happens. When two fields share a name but not an
encoding, point that out.

Reason: "the response contains the client data" hides the difference between the JSON text, the
bytes, and the base64url string. That difference determines whether a hash or signature will
verify.

### Separate signed from transported

If a response carries authentication, say which parts are covered by it and which are merely
carried alongside. Do not let the reader infer that everything in an authenticated response is
authenticated.

Reason: an unsigned field that looks signed is a security bug in the reader's mental model, and
later in their code.

### Keep the operation in prose, the background in blockquotes

What is sent, returned, or done stays in plain prose. Rationale, history, trade-offs, security
notes, and alternatives go in blockquotes.

Reason: it gives the section two reading depths without splitting it in two. A reader following
the mechanics can skip the asides; a reviewer can find them.

### Put detail on the side that performs it

Server-side checks belong in the server's arc, browser behavior in the browser's arc, storage
details in the arc that writes. Do not explain a server comparison while describing what the
browser built, even if that is where the value was created.

Reason: otherwise the reader looks for the effect at the wrong actor and concludes the step does
something it does not.

### Do not forward-reference required information

If a value is used in this arc, explain it here. "Keep X for step 5" and "see below" make the
reader scroll and lose the thread. A cross-reference is for related material, not for something
the current step depends on.

Reason: a document is read out of order, in a browser tab, while someone is debugging. The step
must stand on its own.

### Write the seam the next change will use

If the system is single-user, single-tenant, mock-only, or first-version today but will not stay
that way, say where the new dimension enters and what it would change. Name the field, the
lookup, or the check that would be added.

Reason: without the seam, the future change reads as a rewrite, and the reader cannot see where
the new concept belongs. Naming it also exposes assumptions the current implementation makes.

### Describe each thing once

Give each structure or concept one canonical description, in the place it belongs. Other sections
link to it rather than restating it, and the glossary holds the one-line version.

Reason: duplicated descriptions drift. The copy someone forgets to update becomes the one a
reader trusts.

## Review pass

Read the document against these questions in order. They catch most of the errors in this genre.

1. **Provenance** — where does each value come from, and who produces it?
2. **Containment** — what is inside what? Is that visible from the structure, not just the prose?
3. **Timing** — when does this happen relative to the other steps?
4. **Layer** — is this raw bytes, an encoded string, a parsed object, or a stored row?
5. **Authentication** — is this value signed or authenticated, or merely transported?
6. **Actor** — which side performs this: client, server, browser, OS, library, third party?
7. **Duplication** — is this described in more than one place, and do the copies agree?
8. **Durability** — does this only describe today's single-user, mock, or first-version state?

If an answer is "it is implied", make it explicit. If two answers conflict, one of them is wrong
and the document is the place to find out which.

## Anti-patterns

- A diagram followed by numbered steps that do not map to its arrows.
- Field lists in prose where a literal would be shorter and unambiguous.
- Mixing "what happens" with "why it was designed that way" in the same paragraph.
- Explaining a server-side check in the browser step because that is where the value was created.
- "See below" for a structure that the current step depends on.
- Repeating the same JSON block in three sections, where the copies will eventually disagree.
- Claiming a property ("signed", "encrypted", "verified", "safe") that the mechanism does not
  actually provide.
- Documenting only the happy path, with failures left to a page nobody reads.
- Describing a binary structure as if it were JSON because JSON is easier to write.

## Reference

`references/api-trace.md` — a fill-in template for an operation walkthrough, a worked example, and
a provenance worksheet.
