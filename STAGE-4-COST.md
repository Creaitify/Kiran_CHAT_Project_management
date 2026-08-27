# Module three — what it cost

Stage 4 Part A asked for a third module and, more importantly, for a measurement:
how much of the work was module logic, and how much was fighting the shell?
*"Anything in the second category is a contract defect — fix it in the contract,
not the module, and update MODULES.md. If this module is not markedly cheaper
than chat was, Stage 2 was wrong and this is where we find out."*

This is that measurement. It is deliberately unflattering where it should be.

---

## What was built

**Notes** — a personal scratchpad at `/:workspaceSlug/notes`. List on the left,
editor on the right, everything in `localStorage`.

Chosen for what it does *not* have. The one Stage 2 constraint nobody had tested
was *"the contract must not assume a module has a backend, since some will
not."* `hello` has no backend but also no state; chat has one of the heaviest
backends in the product. Notes is the case in between: real state, real
persistence, real palette entries, **zero server**.

---

## The number

| | Chat (Stage 3) | Notes |
| --- | --- | --- |
| Files in the app directory | 60+ | 7 |
| Lines (excluding comments and blanks) | ~5000 | **293** |
| Shell lines edited to add it | several files; the contract changed | **4 — an import and an array entry, in `registry.ts` and `routes.ts`** |
| Migrations | 3 | 0 |
| API endpoints | 21 | 0 |
| Compiled first try | no — 84 errors | **yes** |
| Contract defects found | many; the contract was still being written | **1** |

Chat is not a fair comparison on volume — it was a 5000-line port of an existing
app, and most of that was the app, not the shell. The comparison that matters is
the last two rows.

---

## Friction log

Everything that was *not* writing Notes.

### 1. `handlePowerKNavigate` silently dropped the query string — **a real contract defect**

Notes wants `?note=<id>` so the palette can jump to a specific note. Routed
through the shell's navigation helper, that becomes `/kiran/notes` — the helper
normalises through `joinUrlPath`, which returns `new URL(...).pathname`, and a
pathname has no query.

**Chat hit this too**, a day earlier, and worked around it by calling
`router.push` directly. That workaround was the mistake: two apps independently
tripping over the same shell behaviour is the definition of a contract defect,
and the second occurrence is what made it visible as one.

Fixed in the shell. The helper now splits a trailing `?`/`#` off the last segment
before joining and re-attaches it after. All 34 existing call sites pass bare path
segments, so nothing else moved — verified by running the algorithm against both
the new cases and the old ones. Both apps are back on the shared helper, and
MODULES.md no longer carries a warning about it because there is nothing to warn
about.

**This is the single thing Stage 4 Part A was designed to catch, and it caught
it.**

### 2. Contribution hooks run for hidden apps — annoying, correct, documented

`useNotesPowerKCommands` is called even when Notes is gated away, because
`contributions.ts` iterates the *registered* apps rather than the visible ones —
a variable hook count breaks React's hook order. So `useNotes` takes an `enabled`
flag it would not otherwise need.

Not a defect. It is the price of hooks-on-a-manifest and it is written down in
two places. But it is real friction and the next app will pay it too.

### 3. localStorage and SSR — not the shell's fault

The first client render has to match the server's, so notes are read in an
effect rather than a state initialiser. That is a React fact, not a contract
problem, and any app with client-only state will meet it.

### 4. Everything else was free

- `useAppContext` gave user, workspace, `t` and router. No shell internals reached
  into.
- Skipping `useBadge` while implementing `usePowerKCommands` worked with no
  ceremony — the optional half of the contract is genuinely optional.
- Two route files, four registration lines, `react-router typegen` green first
  run, `tsc --noEmit` clean first run.
- The rail, the palette and lazy-loading needed nothing.

---

## The second data point: Operations

Notes was the easy case — small, no backend. **Operations** is the hard one: four
new tables plus three join/derived ones, 21 endpoints, three beat tasks, five
screens. If the contract only held for toy apps, this is where it would break.

| | Chat | Notes | Operations |
| --- | --- | --- | --- |
| App-directory files | 60+ | 7 | 15 |
| Shell lines edited | several files | 4 | **4** |
| Contract changes needed | many | 0 | **0** |
| Compiled first try | no — 84 errors | yes | **yes** |
| Contributions used | 3 of 4 | 1 of 4 | **4 of 4** |

Operations is the first app to use the *whole* contract — badge, palette,
backlinks, and it reads another app's entity kind without importing it. That it
needed **zero** contract changes, after Notes needed one, is the actual result
here: the fix Notes forced was the last thing missing.

### What Operations fought

Nothing in the shell. The friction was all domain modelling, which is the right
kind:

- **`Notification.message` is a JSONField and `sender` is a required
  un-defaulted CharField.** I had assumed text and omitted `sender`; both would
  have failed at insert. Found by reading the model rather than by a test, which
  is luck — the tests that would have caught it cannot run without Docker.
- **A dead import justified by a fake function.** I wrote a `unused_marker()`
  whose only job was to keep `Count` imported. Removed both. Same smell appeared
  once in the frontend and was removed there too.
- **Index names again.** Django caps them at 30 characters; all thirteen new
  ones were checked against that before the migration was written, because this
  bit once already.

## The verdict

**Stage 2 holds, and now on evidence rather than a hunch.** A third app cost
seven files and four registration lines. A fourth app — with four tables, 21
endpoints and five screens — cost fifteen files and the same four lines, and
needed no contract change at all. Nothing in the shell had to learn what a note
or a timesheet is.

The one thing Notes fought was a defect chat had already hidden by working
around it — exactly the failure mode Part A exists to surface, and it surfaced on
the first try. Operations then went in behind it and fought nothing.

**Not yet proven:** none of this has run. `typegen` and `tsc` are green, every
Python file byte-compiles, the cost arithmetic and the formatters are verified by
standalone harnesses, and neither app has ever been mounted in a browser. See
`PLAN.md` Part B.
