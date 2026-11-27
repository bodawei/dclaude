# dclaude

**d**ump-**claude**-info: a token usage report for [Claude Code](https://claude.com/claude-code), built from the session transcripts it keeps in `~/.claude/projects`.

For every turn (each prompt you type) and every API call within it, `dclaude` shows the model, effort level, total input, output, uncached input, cache writes, cache reads, thinking tokens, timing, and the start of your prompt. Subagent transcripts are included under the session that launched them.

Requires Node.js 21 or later. Reads local files only; nothing is sent anywhere.

## Install

```sh
npm install -g dclaude
```

Or run it without installing:

```sh
npx dclaude --summary
```

## Usage

```sh
dclaude [path ...] [options]
```

`path` defaults to `~/.claude/projects`. You can also pass one project folder inside it, or a single `.jsonl` transcript.

| Option             | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(none)_           | Markdown report: a summary table by project, then each session's turns with one row per API call                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--summary`        | Only the per-project summary table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--no-calls`       | One row per turn; hide the per-API-call rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--csv`            | CSV instead of Markdown: one row per API call (per turn with `--no-calls`, per project with `--summary`). Times are ISO 8601 UTC                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--hide-worktrees` | Merge workspace folders into their project: Claude Code worktrees `<project>/.claude/worktrees/<name>` into `<project>`, and `.../conductor/workspaces/<project>/<workspace>` into `.../conductor/workspaces/<project>`                                                                                                                                                                                                                                                                                                                                               |
| `--tail`           | Full-screen view of the most recent turns, refreshed every second. Consecutive turns in the same project are grouped under a line naming the project (with the time of its latest turn and their total `COST`). Each turn line shows the model (`claude-` dropped, `multiple` if the turn used several), its effort and flags when there is room, `INPUT-NEW` (new-input + cache_write), `INPUT-CACHED` (cache_read), `OUTPUT`, the start of the prompt, and `COST` when a price file exists (see [Costs in `--tail`](#costs-in---tail)). Press `q` or Ctrl-C to quit |
| `--help`, `-h`     | List the options and columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--version`, `-v`  | Print the version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Examples:

```sh
dclaude > usage.md                       # full Markdown report
dclaude --csv > usage.csv                # every API call, for a spreadsheet
dclaude --summary --hide-worktrees       # one row per project, worktrees and conductor workspaces merged
dclaude ~/.claude/projects/-Users-me-repos-app --no-calls
dclaude --tail
```

## Costs in `--tail`

If `~/.dclaude_costs` (or `~/dclaude_costs`) exists, `dclaude` reads it at startup and `--tail` adds a `COST` column on the right: each turn's cost in dollars, combining new-input, output, cache writes (priced by cache TTL, 5-minute or 1-hour) and cache reads. The file is a JSON object keyed by model name, exactly as it appears in the transcripts (e.g. `claude-opus-5-5`):

```json
{
  "claude-opus-5-5": {
    "input": { "dollarCost": 5, "perTokens": 1_000_000 },
    "output": { "dollarCost": 25, "perTokens": 1_000_000 },
    "5mPromptCacheWrite": { "dollarCost": 6.25, "perTokens": 1_000_000 },
    "60mPromptCacheWrite": { "dollarCost": 10, "perTokens": 1_000_000 },
    "hitAndRefresh": { "dollarCost": 0.5, "perTokens": 1_000_000 }
  }
}
```

### Prices that depend on prompt size

Some models charge more when the prompt is long. Add `overPromptTokens` to such a model, keyed by token count, with the same five prices for calls whose prompt is over that size. The prompt size is the call's whole input: new-input + cache_write + cache_read. Each call is priced on its own, and when there are several thresholds, the largest one the prompt exceeds wins. Models without `overPromptTokens` use one price for every call.

```json
{
  "claude-haiku-5-5": {
    "input": { "dollarCost": 0.1, "perTokens": 1_000_000 },
    "output": { "dollarCost": 0.5, "perTokens": 1_000_000 },
    "5mPromptCacheWrite": { "dollarCost": 0.125, "perTokens": 1_000_000 },
    "60mPromptCacheWrite": { "dollarCost": 0.2, "perTokens": 1_000_000 },
    "hitAndRefresh": { "dollarCost": 0.01, "perTokens": 1_000_000 },
    "overPromptTokens": {
      "100_000": {
        "input": { "dollarCost": 0.5, "perTokens": 1_000_000 },
        "output": { "dollarCost": 2.5, "perTokens": 1_000_000 },
        "5mPromptCacheWrite": { "dollarCost": 0.625, "perTokens": 1_000_000 },
        "60mPromptCacheWrite": { "dollarCost": 1, "perTokens": 1_000_000 },
        "hitAndRefresh": { "dollarCost": 0.05, "perTokens": 1_000_000 }
      }
    }
  }
}
```

### Batch, fast mode and data residency

Add `multipliers` to a model to price calls made in a non-default mode. Each key is a name the `flags` column shows (`batch`, `priority`, `fast`, `us-inference`, ...), and its value scales every price of a call with that flag: input, output, cache writes and cache reads. A call with several flags gets all of them multiplied together, applied on top of any `overPromptTokens` prices. A call whose flag has no multiplier for its model shows `?`, since its cost isn't known (`fallback` is the exception: it doesn't change the price).

```json
"claude-opus-5-5": {
  ...,
  "multipliers": { "batch": 0.5, "fast": 2, "us-inference": 1.1 }
}
```

The figures above are only an example; fill in current prices yourself. `_` digit separators are allowed. A turn that used a model missing from the table shows `?`. If the file is malformed, `dclaude` reports the problem and exits.

## Columns

| Column         | Meaning                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| time           | When the request was sent (local time in Markdown, UTC in CSV)                                                                                                                  |
| secs           | Call: request sent → last response block written. Turn: first request → last response, including time spent running tools                                                       |
| thinking-level | Effort setting recorded for the call (`low` … `max`)                                                                                                                            |
| flags          | Non-default modes, blank when none: `batch` / `priority` (service tier), `fast` (fast mode), `us-inference` (inference region), `fallback` (request re-run on a fallback model) |
| input          | Total prompt size = new-input + cache_write + cache_read                                                                                                                        |
| output         | Output tokens, including thinking                                                                                                                                               |
| calls          | API calls in the turn                                                                                                                                                           |
| new-input      | Uncached input tokens after the last cache marker (`usage.input_tokens`)                                                                                                        |
| cache_write    | Input tokens written to the prompt cache                                                                                                                                        |
| cache_read     | Input tokens served from the prompt cache                                                                                                                                       |
| thinking       | Thinking tokens (part of output)                                                                                                                                                |

## Reading the numbers

- **Every API call resends the whole conversation.** That's why `input` is large even for short prompts, and why `cache_read` grows call after call.
- **`new-input` is usually tiny** (2–4 tokens). Claude Code puts a cache marker at the end of the newest message, so almost everything counts as a cache write or read.
- **Each call's `cache_read` equals the previous call's `cache_read + cache_write`** while the cache stays warm.
- **Claude Code writes one transcript record per content block,** each repeating the same usage. `dclaude` counts each API response once, by message id.

## Development

dclaude has no runtime dependencies. The code is three layers, each in its own folder under `lib/`, and [`bin/dclaude.mjs`](bin/dclaude.mjs) runs them in order: load the files, transform the data, present it as Markdown, CSV or `--tail`. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) describes the layers and the rules that keep them apart. The dev tools need pnpm 10:

```sh
pnpm install
node bin/dclaude.mjs --summary
```

```text
.
├── bin/dclaude.mjs                   Command line: options, help text, runs the three layers
├── lib/load/                         Layer 1, loading: read files, decode them, nothing else
│   ├── transcripts.mjs               .jsonl transcripts -> projects, sessions, turns, calls
│   └── prices.mjs                    ~/.dclaude_costs -> per-token rates
├── lib/transform/                    Layer 2, transformation: independent of any output
│   ├── projects.mjs                  totals, ids, empty data dropped, workspaces merged, turns
│   └── costs.mjs                     pricing calls; null when a cost can't be known
├── lib/present/                      Layer 3, presentation: one file per output
│   ├── common.mjs                    shared helpers: times, secs, numbers, money, fit
│   ├── markdown.mjs                  the Markdown report (default)
│   ├── csv.mjs                       --csv
│   └── tail.mjs                      --tail: tailFrame() lays out a screen, runTail() drives it
├── test/                             one file per layer, plus cli.test.mjs and helpers.mjs
├── docs/ARCHITECTURE.md              The three layers, their rules, where a change goes
├── docs/ROADMAP.md                   Long-term projects and their current state
├── .claude/skills/                   Skills for agents: JavaScript conventions, product and tech docs
├── .github/workflows/                The PR check: lint, format, tests
├── AGENTS.md                         Conventions for agents (CLAUDE.md points here)
├── .oxlintrc.jsonc                   Lint rules
└── .oxfmtrc.json                     Formatter settings
```

| Purpose          | Command             |
| ---------------- | ------------------- |
| All tests        | `pnpm test`         |
| Lint             | `pnpm lint`         |
| Apply lint fixes | `pnpm lint:fix`     |
| Format           | `pnpm format`       |
| Format check     | `pnpm format:check` |

`oxfmt` owns formatting and import order, Markdown included; `oxlint` owns everything else, with the `correctness`, `suspicious` and `perf` categories and the `unicorn`, `oxc`, `import` and `node` plugins. `pnpm lint` and `pnpm format:check` only report; `pnpm lint:fix` and `pnpm format` rewrite files, so read the diff.

Every pull request runs `.github/workflows/check.yml`, which fails on any lint warning, any formatting difference, or a failing test. It never changes files: fix problems locally and push again.

## Pricing references

Wheeeee!

- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/settings/billing
- https://platform.claude.com/usage
- https://claude.com/pricing

From Claude code:

There are three different things called credits, and they don't mix.

1. Usage credits (for your Claude subscription). These are a way to keep working after you hit your plan's limits.

They're for individuals subscribed to paid Claude plans (Pro, Max, and Ultra) to continue using Claude after reaching their included usage limits. Normally most paid plans have a session limit that resets every five hours and a weekly limit. claude
Once you're past your limits, your subsequent usage will be billed at standard API pricing rates. Usage credits are charged separately from your paid Claude subscription and appear as additional charges on your bill. claude
Usage credits apply to both Claude conversations and Claude Code terminal usage. claude
You can set a monthly spending cap and auto-reload settings: automatically purchase additional credits when your balance drops below a threshold. claude
Expiration: Credits purchased before December 7, 2026 don't expire. Generally, usage credits purchased on or after December 7, 2026 expire 12 months after purchase. That change is about two weeks away, so it may matter if you're planning to buy. claude

2. Monthly API credits (included with Max and Team). These are a free allowance for the developer API, not for the Claude apps.

Claude Max and Team plans include monthly credits for the Claude API. To claim your credits, you link a Claude Console organization to your plan. claude
Unused credits expire at the end of each billing cycle. Monthly API credits can't be used in Claude Code or the Claude apps, including for extra usage. claude
Tech press reported the amounts as $100 for Max 5x, $200 for Max 20x and up to $500 pooled for Team subscribers. techenclave

3. Prepaid API credits (Claude Console). This is how you pay for raw API calls.

Claude API and playground usage is billed through prepaid usage credits. Buy credits before you use the API, and they're applied to your usage according to our current pricing. claude
If you run out of credits, you can no longer call the API or use the playground until you add more. claude
