# KIRAN — the plan from here

Supersedes the "Remaining actions" section of
[CHAT-INTEGRATION-STATUS.md](CHAT-INTEGRATION-STATUS.md), which tracked chat
only. This tracks everything `INTEGRATION-ROADMAP.md` asked for.

Split by the thing that actually gates the work: **Part A needs nothing but an
editor. Part B needs Docker and a browser.** They interleave — see
[Ordering](#ordering).

Last updated after `bcc9c48`, pushed to `origin/chat-functionality-updated`.

---

## Where things stand

| Stage | State |
| --- | --- |
| **1 — Baseline and connectors** | Done. |
| **2 — The module system** | Done. Contract expresses badges and palette contributions; the event channel has a real subscriber. |
| **3 — Chat** | Built. 4 of 5 "done when" clauses met **in code**. Nothing verified in a browser. |
| **4 — Prove the platform, PM refresh** | All three parts built in code. Nothing run. |

The honest summary: a great deal is written and almost none of it has been
*run*. Every line below Part B exists because of that, and Part B is where the
risk actually lives.

**Two things are true at once and both matter.** The backend was verified once,
early, with a smoke test — rooms, idempotent sends, tombstones, the polling
delta. Everything added since (the AI endpoint, the release sweep, mention
groups, the overview endpoint) has never touched a database.

---

## Part A — no Docker required

Editor-only work. Each item says why it is here rather than in Part B.

### A1. Fix the own-message bubble contrast — **30 minutes**

One of the three defects Stage 3 named and said to *"fix or consciously defer,
do not port silently"*. It was ported silently.

`.message-bubble-mine` (`core/apps/chat/styles.css:343`) paints
`--chat-gradient-brand` behind `text-primary-foreground`. DESIGN.md marks that
gradient **decorative only, never put text on this**. Measured against white:

| Stop | Ratio | |
| --- | --- | --- |
| `#16bce9` | **2.23:1** | fails WCAG AA (needs 4.5) |
| `#217de8` | **4.07:1** | fails |
| `#334cbe` | 7.20:1 | passes |

At 135° the cyan sits under the *first line of text*. So: every message you
send, in the light theme.

The fix is already written down — DESIGN.md's `--gradient-brand-safe`
(`#007ca7 → #006cdb → #344cbe`) clears AA across the whole ramp, worst stop
4.73:1, and keeps the same movement. The dark-theme variant at
`styles.css:180` needs the same check in the other direction.

*Why not Part B:* contrast is arithmetic, not appearance. It is decided before
anything renders. Do it **before** A2/B4 so you only look at chat once.

### A2. Move chat's strings into `@plane/i18n` — **half a day**

22 strings still live in `core/apps/chat/lib/i18n.tsx`. The blocker was never
the move — it is that `packages/i18n` runs a `sync:check` that fails when
locales disagree, and there are **19** of them. Adding 22 English keys means
adding 22 keys nineteen times.

This repo has a `translate` skill scoped to `KIRAN-MGMT-main/` that exists for
exactly this: do-not-translate terminology, CLDR plural forms, placeholder
preservation, per-locale register. Use it rather than hand-rolling.

*Why not Part B:* `sync:check` is a lint, not a runtime.

### A3. Presence — decide, then build or delete — **decision first**

Everyone renders offline because nothing publishes a heartbeat. Grey dots that
always mean "offline" are a lie the UI tells honestly; green dots that mean
nothing are worse.

Three options, in ascending cost:

1. **Delete the dots.** Honest, free, and loses nothing chat currently has.
2. **Polled heartbeat.** A `last_seen_at` column on `ChatRoomMember`, touched by
   the existing 3-second poll, read back in the overview payload. Fits the
   architecture already there. Half a day.
3. **Wait for websockets.** `apps/live` has never bound its port; this is not a
   plan, it is a hope.

`@here` narrows to online members, so option 1 also means `@here` and `@channel`
become the same thing — say so in the UI if you take it.

*Why not Part B:* it is a product decision plus a schema change.

### A4. Stage 4 Part A — module three — **DONE, in code**

Built: **Notes**, a personal scratchpad with no backend at all — chosen because
the one Stage 2 constraint nobody had tested was *"the contract must not assume a
module has a backend."*

The measurement is in [STAGE-4-COST.md](STAGE-4-COST.md). Headline: 7 files, 293
lines, 4 registration lines, `typegen` and `tsc` green first run, and **one
contract defect found** — the navigation helper silently dropped query strings,
which chat had already worked around rather than reported. Fixed in the shell;
both apps use it normally now.

Still needs B4 to have been seen running.

<details><summary>The original brief</summary>

The point is not the module. The point is **measuring what fighting the shell
costs**. Track the split: work that was module logic vs. work that was the
contract not fitting. Anything in the second column is a contract defect — fix
it in the contract and update MODULES.md, never in the module.

If module three is not markedly cheaper than chat was, Stage 2 was wrong and
this is where you find out.

Two things now exist that chat had to invent, so the comparison is fairer than
it would have been a week ago: `useBadge` and `usePowerKCommands`.

*Why not Part B:* you can build and typecheck it entirely offline. Seeing it
mount is B-work.

</details>

### A5. Stage 4 Part C — cross-module links — **DONE, in code**

Both directions, neither app importing the other:

- **A work-item link pasted into chat renders as a `KIR-42` chip.** Chat hands
  the href to the registry and gets a label back; it has no idea what a project
  identifier is.
- **A work item's sidebar lists the conversations about it.** Projects asks the
  registry for backlinks and renders what comes back; it never learns the answer
  came from chat.

The contract is `core/apps/links.ts`. A ref is three opaque strings —
`{appKey, kind, id}` — deliberately, because the moment that file enumerates
`"work-item" | "room"`, adding an app means editing the shell.

<details><summary>The original brief</summary>

A chat message referencing a work item; a work item showing its conversation.
The first genuine test of whether modules cooperate **without coupling**.

The seam already exists and is already used: `chat:message.created` and
`projects:work-item.opened` are declared in `TAppEventMap`, and the rail badge
proves a subscriber can live in a third place that knows neither app.

The rule that makes this a platform test rather than a feature: **apps must not
import each other.** If projects needs to render a chat link, that is either an
event, a contract addition, or a shared type — never
`import { something } from "../chat"`.

</details>

### A6. Revisit three recorded decisions — **an afternoon of argument**

All three are written up with their reasoning in CHAT-INTEGRATION-STATUS.md.
None is a bug; each is a trade someone should agree to before this merges.

- **Re-registering Tailwind defaults globally.** `text-sm` now resolves
  everywhere in `apps/web`, so the design system can be bypassed outside chat.
  Tailwind v4's `@theme` is a global registry and cannot be scoped, so there is
  no version of this that avoids the leak. The alternative is rewriting every
  className across ~5000 lines.
- **Polling instead of websockets.** One file to swap later.
- **shadcn vendored next to propel.** Nine of 44 components, scoped to chat.

### A7. Stage 4 Part B — PM features — **DONE, in code**

All five Scope.pdf asks, built as a fourth app rather than bolted onto Projects.
You asked for all five; I flagged that building all five was the risk and you
reaffirmed, so that is what is here.

**Operations** (`/:workspaceSlug/operations`) — five tabs over one domain:

| Ask | Where it landed |
| --- | --- |
| Cross-department project linking | `Department`, `ProjectDepartment`, `ProjectLink` + a nightly suggester |
| Time allocation per employee/project | `TimeEntry`, minutes as integers |
| Cost tracking | `MemberRate`, effective-dated; cost **derived, never stored** |
| Scheduled weekly reports | `ReportSchedule` / `ReportRun` + a beat task |
| Task reminders | `Reminder`, pointed at an opaque `{kind, id}` |

Four decisions worth arguing with before this merges:

- **Cost is never stored.** A `TimeEntry` records minutes; money comes from
  whichever rate was in force *on the day*. A stored cost column would freeze it
  at write time, and the first backdated correction would leave every past
  report disagreeing with the present.
- **Unpriced time is reported, never priced at zero.** A department that looks
  cheap because half its people have no rate is the wrong thing to hand someone
  making a budget decision.
- **Department rows sum to more than the workspace total**, because a shared
  project counts in both. The screen says so. The alternative — splitting by an
  invented ratio — is a number nobody can defend.
- **"Automatic" linking stops at proposing.** The nightly sweep suggests a link
  when two projects in different departments share three or more people, writes
  the sentence explaining it, and does nothing until a person accepts.

Timesheets and rates are the parts that could hurt someone: your own time is
yours, everyone else's is admin-only, and rates are admin for read *and* write.
Most of the contract test file is about exactly that.

**Migration 0127.** Not applied.

<details><summary>The original brief</summary>

From Scope.pdf: cross-department project linking, time allocation per
employee/project, cost tracking, scheduled weekly reports, task reminders.

**Build only what is asked for.** This item cannot start until you pick. Naming
two is more useful than ranking five.

</details>

---

## Part B — needs Docker and a browser

```bash
docker compose -f KIRAN-MGMT-main/docker-compose-local.yml up -d
```

Ordered by information-per-minute. B1–B3 are cheap and tell you whether the
rest is worth starting.

### B1. Apply the migrations — **2 minutes**

```bash
docker start -a kiran-mgmt-main-migrator-1
```

`0125` (the scheduled-release index) and `0126` (the mention-group tables) are
new and unapplied. The migrator is `restart: "no"`, so it will not self-heal —
if it raced on `os.makedirs(/code/plane/logs)` on first start, re-run it.

Nothing else in Part B works until this does.

### B2. Run the test suite — **10 minutes, highest value in this document**

```bash
docker compose -f KIRAN-MGMT-main/docker-compose-local.yml exec api pytest plane/tests -k chat -q
```

**Roughly 82 test cases across five files have never been executed.** They were
written against a database they have never seen.

| File | Cases | Covers |
| --- | --- | --- |
| `unit/views/test_chat_agent.py` | 19 | SSE framing, history sanitisation, provider dispatch |
| `contract/app/test_chat_agent_app.py` | 15 | both error contracts, both modes, transcript fencing |
| `unit/bg_tasks/test_chat_scheduled_task.py` | 9 | the release sweep, and the `updated_at` bump it exists for |
| `contract/app/test_chat_user_group_app.py` | 24 | handle rules, admin-only writes, the group-row touch |
| `contract/app/test_chat_overview_app.py` | 15 | the badge's arithmetic |

Expect failures. Hand-written migrations, hand-written fixtures and an untested
`Greatest`-in-an-`UPDATE` are exactly the things that look right and are not.

### B3. Check the wiring — **2 minutes**

```bash
docker compose -f KIRAN-MGMT-main/docker-compose-local.yml exec api python manage.py check
```

Should be clean, and `plane.app.urls.chat` should register **20** routes. A
circular import or a name collision surfaces here, instantly, rather than as a
blank screen in B4.

### B4. Open chat in a browser — **THE remaining unknown**

```bash
cd KIRAN-MGMT-main && pnpm --filter web dev
```

Two machine-specific traps, both already hit once. `pnpm` is not on PATH and
`corepack enable` fails without admin — use
`corepack enable --install-directory "$env:LOCALAPPDATA\pnpm-shims" pnpm` and
prepend that directory. And with 7.7 GB of RAM, plain `pnpm dev` exhausts OS
threads: prebuild at low concurrency
(`pnpm exec turbo run build --filter=web^... --concurrency=2`), then run the one
app.

`http://localhost:3000` — **not** `127.0.0.1`. The API's CORS allowlist only has
the `localhost` forms. Sign in as `admin@kirancableppl.com` / `KiranDemo!2026`.

A 5000-line port that typechecks is not a 5000-line port that renders. In the
order things are most likely to break, with where to look when each does:

1. **Does it render at all?** Blank pane → the store's boot effect,
   `store/chat-store.tsx`, the `bootstrapChat` call. Browser console first.
2. **Is the conversation list populated?** Rooms load but members are empty →
   the workspace member store had not fetched when chat mounted.
3. **Send a message.** The whole optimistic path: local row appears, `POST`
   fires, the row adopts the server id, the tick goes solid.
4. **Second browser, different user.** Messages within ~3 seconds. The only test
   of the real-time path.
5. **Ask the agent something.** With no LLM configured: *"AI is not configured
   for this instance"* in a dismissible bubble, not a hang. See B6.
6. **Create a mention group, then type `@`.** The handle appears under the
   people. Mention it as someone in the group → the room badge counts it as a
   mention, not just a message.
7. **Leave chat and look at the rail icon.** A count; red rather than grey if a
   mention is among them. Open the room → clears within a second. That second is
   the event channel, not the poll.
8. **Power-K, type a room name.** It should land you *in that room*. If it lands
   on chat's default conversation, a query string is being stripped.
9. **The right-hand context panel at desktop widths.** Named as unreachable in
   the original chat; unverified since the port.
10. **All five themes.** The Stage 3 clause this fails is *"no chat-specific
    CSS"* — two stylesheets exist by deliberate decision (A6). What still has to
    be true is that the palette is unchanged. If a colour moved, the port is
    wrong. Check A1's fix here too.
11. **Open Notes from the rail, write one, find it in Power-K.** Module three,
    and the first real check that the query-string fix landed.
12. **Paste a work-item URL into a chat message.** It should render as a
    `KIR-42` chip, not a raw link. Then open that work item — its sidebar should
    list the message.
13. **Open Operations.** Log time against a project; Cost should price it once a
    rate exists and list it as *unpriced* until one does. Create a department,
    put a project in it, check the department row.
14. **Set a reminder a minute out.** The rail badge should go red within two
    minutes and the notification should arrive — that needs the worker and beat.

### B5. Scheduled messages, end to end — **needs worker and beat**

Schedule a message a minute out. **Refresh the tab.** It must still be in the
scheduled list, and it must arrive with the tab closed.

This is the one thing that cannot be checked any other way — it needs the Celery
worker *and* beat running, and beat fires every minute.

### B6. The AI assistant against a real provider — **needs a key**

Set `LLM_API_KEY` / `LLM_PROVIDER` / `LLM_MODEL` — the same config the rest of
Plane's AI uses; chat's assistant needs no new settings.

The thing to watch: **text should appear progressively.** If the whole answer
arrives in one lump, something downstream is buffering the stream and the
`Content-Encoding: identity` / `X-Accel-Buffering: no` headers are being
stripped. That failure looks like "it works" and is why it is called out.

### B7. Attachments — **unknown until run**

The endpoint is wired (`CHAT_ATTACHMENT` entity type, mime allowlist widened
past images) and the upload path has **never executed once**. Budget for finding
real problems, not for confirming it works.

---

## Ordering

The two parts are not sequential. The cheap, high-information Docker work comes
first, and the code work fills the gaps.

```
B1  apply migrations                    ─┐
B2  run the tests            ← do first  │  90 minutes, and it decides
B3  manage.py check                     ─┘  whether anything below is real

A1  fix the contrast          ← before you look at chat even once

B4  open chat in a browser    ← the real unknown; expect a day of fixes
B5  B6  B7                    ← each needs its own moving part running

A3  presence: decide          ← needs no environment, blocks nothing
A2  i18n                      ← self-contained, do it when you want a quiet task

A4  module three              ← DONE in code
A5  cross-module links        ← DONE in code
A7  PM features               ← DONE in code

A6  revisit the three decisions ← before any of this merges
```

**If you only do one thing: B1 → B2.** Ninety minutes, and it converts roughly
82 assertions from "written" to "known".

---

## Open decisions

| # | Decision | Blocks | Why it is yours |
| --- | --- | --- | --- |
| 1 | ~~Which PM features actually matter?~~ | — | **Answered: all five.** Built as the Operations app. |
| 2 | What is module three? | A4 | Naming it late invites accidental special-casing of chat. |
| 3 | Presence: delete, poll, or wait? | A3 | Product call, not an engineering one. |
| 4 | Does chat need mobile? | B4 | Chat's layout assumes desktop; the shell is responsive. |
| 5 | Neon: migrate existing data or start clean? | — | The API already reads `DATABASE_URL`; there is no second connection string. |

---

## Not in scope, deliberately

Commitment detection and escalations. Both were out of scope for Stage 3 and
nothing since has changed that. The event channel is the seam they will hang
off when they arrive — that seam now has a real subscriber, which is the only
thing that had to be true early.
