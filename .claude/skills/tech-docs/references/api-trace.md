# Operation across an API trace

A template and a worked example for the walkthrough shape in `SKILL.md`.

## Template

````markdown
## <Operation>

<Backbone: three to five sentences. Who asks, who acts, what comes back. No structures.>

```text
<Actor A>                         <Actor B>                        <Actor C>
   │ (1) METHOD /path                │                                │
   │────────────────────────────────>│ <what B does>                  │
   │ (2) status <shape>              │                                │
   │<────────────────────────────────│                                │
```

### 1. <Actor> → <Actor>: `<METHOD /path>`

<Request: body, query, headers that matter. "No body.">

<Response: status and body literal.>

```json
{ "<field>": "<value>" }
```

| Field | Produced by | Meaning |
| ----- | ----------- | ------- |
| …     | …           | …       |

<What the sender does with the response.>

> <Rationale, provenance, security note, or trade-off.>

### 2. …
````

Each numbered item covers exactly one message. Work that a side performs between messages belongs
in the arc that triggered it. If a message carries a structure, show the literal; if a field has a
non-obvious origin, say who produced it and in which encoding.

## Worked example

How one API response becomes one row in dclaude's report, so the trace has four actors and one
easy mistake: counting the same usage several times.

**Backbone.** Claude Code sends a request to the Anthropic API and logs that it did. The API
streams the response back as content blocks, with a usage object. Claude Code writes one
transcript record per content block, and each record repeats the response's usage. dclaude reads
the file, keeps one call per message id with the last usage it saw, and adds that call to the
turn started by the most recent prompt you typed.

```text
Claude Code                 Anthropic API          transcript (.jsonl)            dclaude
   │ (1) POST /v1/messages     │                          │                          │
   │──────────────────────────>│                          │                          │
   │ (2) api-request record ─────────────────────────────>│                          │
   │ (3) response: content blocks + usage                 │                          │
   │<──────────────────────────│                          │                          │
   │ (4) one assistant record per block ─────────────────>│                          │
   │                           │                          │ (5) read, de-duplicate   │
   │                           │                          │─────────────────────────>│
```

### 1. Claude Code → API: `POST /v1/messages`

The whole conversation so far, with cache markers. dclaude never sees this request; it only sees
what Claude Code writes about it.

### 2. Claude Code → transcript: an `api-request` record

```json
{ "type": "api-request", "id": "req-1", "timestamp": "2026-11-27T01:00:00.000Z" }
```

| Field       | Produced by | Meaning                                                  |
| ----------- | ----------- | -------------------------------------------------------- |
| `id`        | Claude Code | Referenced by the response's records as `requestRef`.    |
| `timestamp` | Claude Code | When the request was sent; dclaude uses it as the start. |

> When a response has no matching `api-request` record, dclaude uses its first record's
> timestamp as the start, so `secs` is shorter than the real wait.

### 3. API → Claude Code: content blocks and usage

The response's text, thinking and tool-use blocks, and one usage object for the whole response.
The token counts are the API's; Claude Code does not compute them.

### 4. Claude Code → transcript: one `assistant` record per block

```json
{
  "type": "assistant",
  "requestRef": "req-1",
  "timestamp": "2026-11-27T01:00:02.000Z",
  "message": {
    "id": "msg_01",
    "model": "claude-opus-5-5",
    "usage": {
      "input_tokens": 3,
      "cache_creation_input_tokens": 100,
      "cache_read_input_tokens": 1000,
      "output_tokens": 50
    }
  }
}
```

| Field           | Produced by   | Meaning                                                 |
| --------------- | ------------- | ------------------------------------------------------- |
| `message.id`    | Anthropic API | The same on every record of one response.               |
| `message.usage` | Anthropic API | Repeated on every record; a later record may be larger. |
| `requestRef`    | Claude Code   | Points back at the `api-request` record in step 2.      |
| `timestamp`     | Claude Code   | When this block was written; the last one is the end.   |

> A response with three blocks writes three records with the same usage. Summing them would
> triple the tokens and the cost. That is the reason for step 5.

### 5. Transcript → dclaude: read and de-duplicate

`parseTranscriptUncached` (in `lib/load/transcripts.mjs`, the loading layer) reads every line, skipping a line cut off mid-write. For an `assistant`
record with usage, it looks up `message.id`: the first record creates a call in the current turn,
and each later one replaces the call's usage and end time. A `user` record that is a typed prompt
starts a new turn; one that only carries tool results does not.

The call's `input` is computed here, by dclaude: `input_tokens + cache_creation_input_tokens +
cache_read_input_tokens`. Its cost is computed later, in the transformation layer, by `costOf` (`lib/transform/costs.mjs`) from the price file, and is
`null` (shown as `?`) when the model or one of the call's flags has no price.

## Provenance worksheet

Fill this in while drafting; it is faster than discovering the gaps during review.

| Value | Produced by | Encoding at this hop | Signed or authenticated? | Used by |
| ----- | ----------- | -------------------- | ------------------------ | ------- |
|       |             |                      |                          |         |

## Checklist before publishing

- The backbone can be read alone and still make sense.
- Diagram numbers and prose numbers are the same set, in the same order.
- Every arc says what is sent and what comes back, including "no body" when that is the case.
- Every structure is a literal, at the arc that uses it.
- Every non-obvious field names its producer.
- Encoding changes are called out where they happen.
- Authenticated and merely transported values are distinguishable.
- Server work is described on the server side.
- No step depends on information introduced later.
- Future dimensions (users, tenancy, retries) have a named seam.
- Nothing is described twice in a way that can drift.
