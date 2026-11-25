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

| Option | What it does |
|---|---|
| *(none)* | Markdown report: a summary table by project, then each session's turns with one row per API call |
| `--summary` | Only the per-project summary table |
| `--no-calls` | One row per turn; hide the per-API-call rows |
| `--csv` | CSV instead of Markdown: one row per API call (per turn with `--no-calls`, per project with `--summary`). Times are ISO 8601 UTC |
| `--conductor` | Merge `.../conductor/workspaces/<project>/<workspace>` folders into one project, `.../conductor/workspaces/<project>` |
| `--tail` | Full-screen view of the most recent turns, refreshed every second: project, `INPUT-NEW` (new-input + cache_write), `INPUT-CACHED` (cache_read), `OUTPUT`, and the start of the prompt. Press `q` or Ctrl-C to quit |
| `--help`, `-h` | List the options and columns |
| `--version`, `-v` | Print the version |

Examples:

```sh
dclaude > usage.md                       # full Markdown report
dclaude --csv > usage.csv                # every API call, for a spreadsheet
dclaude --summary --conductor            # one row per project, conductor workspaces merged
dclaude ~/.claude/projects/-Users-me-repos-app --no-calls
dclaude --tail
```

## Columns

| Column | Meaning |
|---|---|
| time | When the request was sent (local time in Markdown, UTC in CSV) |
| secs | Call: request sent → last response block written. Turn: first request → last response, including time spent running tools |
| thinking-level | Effort setting recorded for the call (`low` … `max`) |
| flags | Non-default modes, blank when none: `batch` / `priority` (service tier), `fast` (fast mode), `us-inference` (inference region), `fallback` (request re-run on a fallback model) |
| input | Total prompt size = new-input + cache_write + cache_read |
| output | Output tokens, including thinking |
| calls | API calls in the turn |
| new-input | Uncached input tokens after the last cache marker (`usage.input_tokens`) |
| cache_write | Input tokens written to the prompt cache |
| cache_read | Input tokens served from the prompt cache |
| thinking | Thinking tokens (part of output) |

## Reading the numbers

- **Every API call resends the whole conversation.** That's why `input` is large even for short prompts, and why `cache_read` grows call after call.
- **`new-input` is usually tiny** (2–4 tokens). Claude Code puts a cache marker at the end of the newest message, so almost everything counts as a cache write or read.
- **Each call's `cache_read` equals the previous call's `cache_read + cache_write`** while the cache stays warm.
- **Claude Code writes one transcript record per content block,** each repeating the same usage. `dclaude` counts each API response once, by message id.


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
