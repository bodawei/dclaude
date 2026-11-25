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
