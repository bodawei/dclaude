# docs/ONE_PAGER.md

## Purpose

Set the direction of the product in about 500 words. This is the document a new collaborator
reads to understand why the product exists and what it should feel like. It is written by the
product owner and is allowed to be evocative.

The one-pager is not a specification. If a sentence would fit better in the PRD, it belongs
there.

## Shape

Write it as an Amazon-style press release: as if the product has launched and a customer is
describing what changed. Use prose, not bullet lists. Prefer concrete scenes over abstractions.

A workable structure:

```markdown
# Product name

## A one-line promise

**The problem.** A specific scene: who is struggling, what are they doing, and why is it painful?

**The promise.** What the product makes possible, in customer language.

**How it works.** A short, non-technical description of the experience. What does the customer
do, and what happens next?

> "A customer quote that sounds like a person, not a brochure."

**What is available now.** The call to action, availability, or next step.
```

## Examples to read

- **[Working Backwards PR/FAQ Instructions & Template](https://workingbackwards.com/resources/working-backwards-pr-faq/)** — the canonical explanation from Colin Bryar and Bill Carr. Read this for the components, the review process, and the FAQ structure. It uses a car example rather than a full press release.
- **[Amazon Working Backwards Press Release Example (Circulert)](https://slab.com/library/templates/amazon-working-backwards-press-release/)** — a complete one-page mock press release for a fictional app. This is the closest thing to the artifact: headline, subhead, dateline, problem, solution, founder quote, customer quote, and call to action. It is a template illustration, not an Amazon-written document, but the shape is right.
- **[An insider look at Amazon's culture and processes](https://www.aboutamazon.com/news/workplace/an-insider-look-at-amazons-culture-and-processes)** — Amazon's own book excerpt. Useful for the length discipline: the press release is a few paragraphs and always less than one page; the FAQ is five pages or less.
- **[Amazon Web Services Launches Amazon S3 — March 14, 2006](https://press.aboutamazon.com/2006/3/amazon-web-services-launches)** — a real Amazon launch press release, not the internal PR/FAQ format. Useful to see a technical infrastructure product lead with a customer promise. It is longer and has legal boilerplate, so use it for tone, not length.

If the links rot, search for "Working Backwards PR/FAQ template", "Circulert press release", and "Amazon S3 launch press release 2006".

## Voice

- Present tense, as if launched.
- One customer, one problem, one promise.
- Customer language, not internal names or architecture.
- Concrete details: a task, a moment, a frustration, a result.
- Confident, not breathless. Avoid "revolutionary", "seamless", "AI-powered" as a substitute for
  a real promise.
- No feature matrix, no personas table, no acceptance criteria, no roadmap, no implementation
  detail.

## Review checklist

- Can a smart outsider explain the product back to you after one read?
- Is the problem concrete enough that someone would recognize themselves in it?
- Does the promise describe a changed outcome rather than a list of capabilities?
- Is there a clear first experience, not just a vision?
- Is every sentence customer-facing, or did implementation detail leak in?
- Is it roughly one page, and does it sound like a person wrote it?
