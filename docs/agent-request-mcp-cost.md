# Request: make the MCP server cheap enough to use often

**Written 2026-09-11 by a Claude Code session working in a *different* repo
(`deepfront`), which used this board as its task list for a full day's work.
This is field feedback from the consumer side, not a spec from someone who knows
this codebase.**

You know this project and I do not. Everything below is a description of what the
MCP surface did to an agent using it, plus a proposed change and how to tell the
change worked. **Where my suggestion conflicts with how this codebase actually
works, your judgement wins — keep the goal, change the mechanism, and say so.**

---

## The economics that make this worth doing

A Claude Code agent pays a **flat fee per turn** — measured in the `deepfront`
repo at **210–230k tokens of context per turn, with 97.9% of the bill being cache
reads**, across 129 sessions and 33,761 tool calls. A one-line `cd` and a deep
code analysis cost the same.

**So the cost of using this board is driven by the NUMBER of calls, not their
size.** One session updating five cards made **nine** MCP calls. Nine turns. That
is roughly what nine code analyses would have cost.

Payload size matters too, but it is the second-order term. Every fix below is
aimed at call count first, payload second.

**What this is NOT asking for:** a faster server, a better UI, or more features.
It is asking for the same information to cost fewer round trips.

---

## Do not break these — they are the good parts

Before any change, note what is already right, because two of the asks below
could damage it if implemented carelessly:

1. **`update_task` is partial.** Send only changed fields; omitted fields are left
   alone. This removes an entire class of error — an agent can write `result`
   without first reading, and therefore without risk of clobbering a human's
   concurrent edit to `requirement`. **Nothing below should make a write
   non-partial, or require a read before a write.**
2. **`notes` leads every board read.** This is the single most valuable design
   decision on the board. It is the only channel that reliably survives a session
   boundary. In one day it carried two facts that would otherwise have cost the
   next session real debugging time: a save-schema invariant, and a piece of
   device state that looks exactly like a regression if you do not know it is
   expected. **Do not reorder or demote it.**
3. **The work log accepts dead ends.** An agent logged a wrong fix it tried before
   the right one, because there was somewhere to put it that was not a commit
   message. Commit messages record what shipped; nothing else records what did
   not work. Keep that.

---

## Change 1 — let one call finish a task (highest value by far)

### The problem

Finishing a task is *always* at least two calls and usually three:

```
update_task(id, status: "done", result: "...")
add_log(id, body: "...")
```

That pairing happened **four times in one session**. Starting a task is the same
shape (`status: "in_progress"` + a log entry saying what the plan is).

### The ask

Let `update_task` accept an optional `log` field that appends a work-log entry in
the same call, with the same semantics `add_log` has today (append-only, attributed,
visible in the human's activity stream).

```
update_task(id, status: "done", result: "...", log: "what happened and what I tried")
```

`add_log` stays as it is — there are real cases where an agent logs progress
without changing any field.

### Why this is the biggest win

It is the difference between nine calls and four for the session described above.
No other change on this list comes close.

### How to tell it worked

- A single `update_task` carrying `status`, `result` and `log` produces exactly
  the same board state as the two-call sequence does today.
- The log entry is attributed and ordered identically to one created by `add_log`.
- Omitting `log` behaves exactly as `update_task` does now (no empty entry
  created).
- The partial-update contract is unchanged: a call carrying only `log` must not
  touch any other field.

### Open question for you

If a multi-task variant is cheap in this codebase, it is worth more than it looks
— closing two related cards is two calls today. But it complicates the partial
semantics and error handling (what does a half-applied batch mean?), so **only if
it is genuinely cheap.** A clean single-task version is the priority.

---

## Change 2 — stop echoing the body back

### The problem

`add_log` returns the **entire body that was just sent**. `update_task` returns
the **whole task object**, including every field the caller deliberately did not
touch.

An agent writing a thorough log entry — one was ~700 words — pays to send it and
pays again to read it back. **This penalises exactly the thoroughness the board is
meant to encourage.** It is also slightly at odds with the documented guidance
for `update_task`, which tells callers not to *send* a whole task object while the
response hands one back.

### The ask

A terse success response. Either as the default, or behind a parameter if
something already depends on the current shape:

```
{ "ok": true, "id": "6aa3f2a500181f11f7b4", "updated": ["status", "result"] }
```

The `updated` list is genuinely useful — it confirms which fields the server
understood, which is the one thing the echo was incidentally good for.

### How to tell it worked

- A write returns a response that does not contain the submitted body text.
- An agent can still confirm the write landed without a follow-up read.
- Anything that currently consumes the full-object response still works (hence
  possibly a parameter rather than a breaking change — your call, you know the
  consumers).

---

## Change 3 — a cheap way to find an ID

### The problem

`get_board` is the designed entry point and **an agent cannot call it** — it
exceeds the MCP token cap. The same content over REST
(`/api/context?project=deepfront`) is **88KB**, roughly 22k tokens.

So the documented workflow ("call `get_board` first every session") is unusable in
practice and every session routes around it. The workaround is
`list_tasks(label: ...)`, which returned **16 complete task objects — every
markdown field on each — to find two IDs.**

Finding an ID currently costs more than the write that follows it.

### The ask

Either of these solves it; both is better:

1. **A field selector on `list_tasks`** — e.g. `fields: ["id", "title", "status"]`
   — so an agent can fetch an index instead of the contents.
2. **Make `get_board` summary-only** so it fits the cap: "Keep in mind" in full
   (it is short and load-bearing), then one line per open task — id, title,
   status, priority — and a count of finished work rather than its text.

Full task bodies stay available through `get_task`, which is the right place for
them.

### How to tell it worked

- `get_board` succeeds without hitting the token cap, on this board at its
  current size.
- An agent can go from "I need the card about X" to "I have its ID" in **one**
  call whose response is a few hundred tokens, not tens of thousands.

---

## Change 4 — accept the short ID, or say what the long one is

### The problem

```
get_task("6aa3f2a5")  →  "no such task: 6aa3f2a5"
```

The short form is what appears in the board URL, so it is what an agent naturally
reaches for. The full 20-character ID is required. That error cost a full turn and
produced nothing.

### The ask

Resolve an unambiguous ID prefix, the way `git` resolves a short SHA. If it is
ambiguous, or prefix matching is awkward here, then make the error carry the
answer:

```
no such task: 6aa3f2a5 — did you mean 6aa3f2a500181f11f7b4 ("The daily ad cap is in-memory…")?
```

A failed call that tells you the right call is most of the value.

### How to tell it worked

- `get_task` with a unique prefix returns the task.
- An ambiguous prefix lists the candidates rather than failing blankly.

---

## Change 5 — age finished work out of the briefing (your call, not mine)

Not a tooling defect — real work accumulating. But it is why the briefing is 88KB,
and finished cards are the bulk of it while almost never being what the next
session needs.

Worth considering whether `done` cards drop out of the *briefing* after some
window (a week?) while remaining fully readable through `get_task` and the web UI.
**This is a product decision about your own board and I am not the right one to
make it** — flagging the cause, since Change 3 treats the symptom.

---

## Change 6 — tags: three quarters of this already works, one quarter does not

**Read this one carefully before building anything, because most of what it asks
for already exists and a naive reading would have you rebuild it.**

### What already works — verified in use, do not touch

- **A task can already carry many tags.** `labels` is an array, up to 20. Real
  cards on the `deepfront` board carry `["store", "ads", "ui", "goshants-call"]`.
- **`list_tasks` already filters by label, and by status, in the same call.** The
  session that produced this document ran
  `list_tasks(project: "deepfront", status: ["in_progress", "todo"], label: "ads")`
  and it returned exactly the three matching cards.

So "let me filter by tag, combined with status, to get a smaller set" is **built
and working.** No change needed.

### The part that does not work: the filter narrows the count, not the cost

That filtered call above — three cards — was fine. The same call with
`label: "store"` matched **16** cards and returned **16 complete task objects,
every markdown field on each**, to find two IDs.

`list_tasks`' own description already says this out loud — *"Returns full task
objects including every markdown field, so this can be a lot of text."* The tool
documents the problem accurately; there is just no parameter to avoid it.

**Filtering reduces how many tasks come back. It does nothing about how much each
task costs.** On a board where a single card's `requirement` and `result` can each
run several hundred words, a filter that matches 16 cards is still a very large
response.

**This means Change 6 does not deliver its stated benefit without Change 3.** A
tag filter plus a field selector is a cheap index. A tag filter alone is a smaller
pile of the same expensive objects. If only one of the two gets built, **build
Change 3** — it helps every query, filtered or not.

### What is genuinely missing — two things

**6a. The query can only name one tag, even though a task can carry many.**

`label` is a single string. There is no way to ask for:

- `store` **AND** `money` — the narrow slice, which is the whole point of
  multi-tagging
- `store` **OR** `ads` — one sweep over a related area instead of two calls

The data model supports multi-tag; the query surface does not use it. Suggested
shape, though the exact spelling is yours:

```
list_tasks(project, labels: ["store", "money"], match: "all")   // AND
list_tasks(project, labels: ["store", "ads"],   match: "any")   // OR, default
```

Keep the existing single `label` parameter working so nothing that uses it breaks.

**6b. A tag is optional, so an untagged task is invisible to every filtered query.**

Goshant's ask: *every task should have a tag.* The risk this addresses is real —
a card with no tags cannot be reached by any label filter, so the more an agent
relies on filtering, the more reliably an untagged card gets skipped. It does not
show up as an error; it shows up as work quietly not being found.

Worth deciding **which** of these you want, because they behave very differently:

- **Required on create** — `create_task` rejects an empty `labels`. Cleanest, but
  it hard-fails a human quickly jotting a card in the web UI, which is probably
  the single most important thing the web UI does.
- **Defaulted on create** — an untagged task silently gets something like
  `untriaged`. Nothing is ever unreachable, the gap is visible on the board, and
  nobody is blocked mid-thought. **This is the one I would pick**, and it composes
  well with 6a: `labels: ["untriaged"]` becomes a real triage queue.
- **Warned, not enforced** — a board-level count of untagged cards surfaced in the
  briefing. Weakest, but zero friction.

There is also **existing data** to deal with either way: whatever is on the board
now with no labels. A backfill to `untriaged` makes the rule true from day one
instead of only for new cards.

### How to tell it worked

- `list_tasks` with two labels and `match: "all"` returns only tasks carrying
  both; with `match: "any"`, tasks carrying either.
- The existing single-`label` parameter still behaves exactly as it does today.
- Every task on the board carries at least one tag, including ones created before
  the rule existed — so no card can be missed by an agent that works through
  label filters.
- Combined with Change 3, a filtered query returns an index of a few hundred
  tokens rather than full bodies.

---

## Priority

| | Change | Why |
|---|---|---|
| 1 | One call finishes a task | Roughly halves call count. Nothing else is close. |
| 2 | Stop echoing bodies | Cheap to build; penalty currently scales with thoroughness. |
| 3 | Cheap ID lookup | Makes the documented entry point actually usable. |
| 4 | Short-ID tolerance | Small, but it is a guaranteed wasted turn each time it bites. |
| 5 | Age out finished cards | Product decision, not a defect. |
| 6 | Multi-tag query + a mandatory tag | Mostly already built. Worth little on its own — pair it with 3. |

---

## One correction, so it is not used as evidence

An earlier note from the same session said the REST fallback "failed." **It did
not.** The endpoint is fine — 401 without a key, 200 with one. The agent piped a
markdown response into a JSON parser and misread its own error. The API is not at
fault and nothing here rests on that claim.
