# Chat integration — status and what's left

Branch: `chat-functionality-updated`. Two commits are pushed; everything below the
line marked **uncommitted** is in the working tree only.

---

## Where it stands

**Stage 2 (module system): complete and verified.**
**Stage 3 (chat): backend complete and verified. Frontend complete and compiling, never opened in a browser.**

| | Built | Compiles | Runs | Seen working |
| --- | --- | --- | --- | --- |
| App registry / rail / palette | yes | yes | yes | yes — screenshots |
| Chat database schema | yes | yes | migrated | yes — smoke test |
| Chat Django API | yes | yes | yes | yes — smoke test, 0 failures |
| Chat React app | yes | yes | ? | **no** |
| AI assistant endpoint | yes | yes | ? | logic only — see below |
| Scheduled message release | yes | yes | ? | not run |
| Mention groups | yes | yes | ? | handle rules only |
| Rail badge / palette rooms / events | yes | yes | ? | not run |

The single gap is still the same one: nobody has loaded `/:workspaceSlug/chat` in
a browser, and the three newest pieces have not run against a real database or a
real LLM provider.

---

## Uncommitted work in this tree

Three of the six items on the old "missing or stubbed" list are now built, plus
the three platform clauses the roadmap asked for that this document was never
tracking. None of it has been run — Docker was deliberately off for this pass —
so all of it is verified as far as static checks and dependency-free logic go,
and no further.

### 1. The AI assistant now has a route

`POST /api/workspaces/<slug>/chat/agent/` — `plane/app/views/chat/agent.py`.

The client's `fetch("/api/agent")`, which had no route behind it and 404'd, now
points here through `ChatService.agentUrl()`. The whole assistant surface it
feeds — `@agent`, the per-room conversation, regenerate, share-to-chat,
summarise — was already ported and wired; this is the half that was missing.

- **Streams.** `text/event-stream`, one `data: {"delta": "..."}` per token group,
  `data: [DONE]` to close. This is not a reversal of the decision in
  `chat/updates.py` to poll: that argument is about *long-lived* connections
  stalling a UvicornWorker's shared executor thread. This response lives exactly
  as long as one LLM call, which blocks the worker whether it streams or not.
- **Providers** come from the existing `get_llm_config()` — Anthropic through
  `messages.stream`, OpenAI and Gemini through the chat-completions stream. No
  new configuration surface; if `LLM_API_KEY` / `LLM_PROVIDER` / `LLM_MODEL` are
  set for the rest of Plane's AI, chat's assistant works.
- **Error contract matches what the ported client already expected.** A failure
  before the first token is an ordinary HTTP error carrying `{"error": ...}`,
  because the store reads that path with `response.json()`. A failure after it is
  an error frame inside a 200, because by then the status line is long gone. The
  first chunk is pulled inside the view specifically so those two cases separate
  correctly.
- **`Content-Encoding: identity` and `X-Accel-Buffering: no` are load-bearing.**
  `GZipMiddleware` is global and its streaming path feeds chunks to zlib, which
  emits nothing until it has a block — every token would arrive at once. Django's
  only opt-out is a `Content-Encoding` already being set. The second header is
  the same problem at nginx.
- **Rate limited per user** — `ChatAgentRateThrottle`, `chat_agent` scope,
  `20/minute`, override with `CHAT_AGENT_RATE_LIMIT`. This closes the note in
  `chat/lib/rate-limit.ts`, which said the client-side budget belongs on the
  server as a DRF throttle. The client's 60k daily budget stays as a courtesy to
  the user; this is the limit on the account.
- **The transcript comes from the client** and the server takes it at its word.
  A forged `context` only degrades the answer the caller themselves receives. It
  is fenced in the system prompt and labelled as data rather than instructions,
  because it is text other people wrote.
- **Permissions**: ADMIN and MEMBER, not GUEST — this follows the other AI
  endpoints rather than the other chat endpoints, because every call spends money
  at a provider.

`get_llm_response`'s five-branch `except` chain was extracted into
`llm_error_message()` so this endpoint reports provider failures in the same
words as the existing ones. Behaviour is unchanged apart from an added
`NotFoundError` branch on the OpenAI side.

### 2. Scheduled messages now survive the browser

It was worse than the old note here said. `scheduleMessage` never called the
server at all: a scheduled message lived in one React state array, did not
survive a refresh, and was released by a five-second `setInterval` that only ran
while its author had the tab open.

The server already had everything needed — the `scheduled_for` column, and both
read paths hiding a queued message from everyone but its author. What was missing
was anything to write it and anything to release it.

- **`scheduleMessage` now dispatches.** The transport was already forwarding
  `scheduled_for`; it was simply never called. One line.
- **`plane/bgtasks/chat_scheduled_task.py`**, on a one-minute beat. One UPDATE,
  no read — there is nothing to decide per row, and a read-then-write would open
  a window for the beat to release the same message twice.
- **The reason that task has to exist is `updated_at`.** The poll is
  `updated_at > since`. A message queued on Monday for Friday still carries
  Monday's `updated_at` on Friday, so without a touch it would sit there
  technically visible and reach nobody until someone reloaded the room.
  `.update()` bypasses `auto_now`, so the task sets it explicitly.
- **A released message claims the time it was promised**, not the time the beat
  ran, so scheduler lag stays out of the transcript — `Greatest(scheduled_for,
  created_at)`, the `Greatest` guarding the other direction so a row can never be
  back-dated to before it was written.
- **`POST .../messages/<pk>/send-now/`** releases ahead of time. A dedicated
  action rather than a writable `scheduled_for`, because releasing is the only
  edit anyone is allowed to make to that column and a writable column would also
  allow rescheduling into the past — a way to insert a message above messages
  people have already read.
- **Cancelling deletes instead of tombstoning.** A tombstone explains a message
  people saw; nobody has seen this one, and nothing can point at it.
- **Creating rejects a past send time** (with a minute of slack for clock skew).
- **The client ticker is gone.** Release is the server's, and the released row
  reaches every client — the author's included — through the ordinary poll.

**Migration 0125** adds a partial index on `scheduled_for`, for the sweep. It has
not been applied — re-run the migrator.

### 3. Mention groups exist

`@engineering`, `@on-call`. The client half of this shipped with the port --
`parseMentions` reads `<!handle>` out of a message, `resolveMentionTargets` fans
it out, the composer offers it in autocomplete, `MarkdownContent` renders it --
and all of it was being handed an empty array. Two tables, a CRUD endpoint and a
management dialog later, it is not.

- **`ChatUserGroup` + `ChatUserGroupMember`**, workspace-scoped rather than
  room-scoped: the point of a handle is that it means the same team wherever it
  is typed. A room-scoped group would be a weaker way of saying `@channel`.
- **Read is any workspace member, write is workspace ADMIN.** A group is
  directory data. Anyone being able to add themselves to `@on-call` makes the
  handle worth less than typing the names out.
- **Membership is not access.** Being in a group means messages to its handle
  notify you. The fan-out intersects the group with the room's own members, so
  mentioning `@engineering` in a room half of them are not in reaches the half
  that are.
- **The handle is validated against the mention tokeniser, not against taste.**
  Mentions are written as `<!handle>` and read back with
  `/<!([a-zA-Z0-9_-]+)>/`; a handle outside that class would be written into a
  message and never parse out of it, so the group would look mentionable and
  notify nobody. `channel`, `here` and `agent` are reserved for the same reason
  — `parseMentions` resolves those before it looks at the group list.
- **Editing the membership touches the group row, deliberately.** This is the
  subtle one. Membership is its own table, so adding someone does not move
  `ChatUserGroup.updated_at`; and a removal is a soft delete performed with
  `.update()`, which bypasses `auto_now`, so it does not move the *membership*
  row's `updated_at` either. Neither table's own timestamp can be the poll's
  signal. Touching the group row makes it one write and leaves the delta with
  nothing to join. A no-op edit is still a no-op.
- **Group mentions now count towards the unread badge.** They did not, and could
  not, before groups existed — the badge knew about direct mentions and
  broadcasts only. Without this the badge would be quietly wrong for exactly the
  people a `@engineering` message was aimed at.
- **The delta cannot report a deletion.** A deleted group is soft-deleted and
  soft-deleted rows are filtered out rather than announced. The admin who
  deleted it drops it locally; everyone else keeps offering the handle until
  their next reload. The failure mode is benign and deliberate: a stale handle
  resolves to nothing, notifies nobody, and renders as plain text.
- **UI**: "Mention groups…" in the sidebar's New Chat menu, opening a two-pane
  dialog (list, then editor). Server-side field errors render against the field
  they belong to rather than as a toast, because "that handle is taken" is
  useless three inches from the input it is about.

**Migration 0126.** Not applied.

### 4. The platform wiring the roadmap asked for

Checking `INTEGRATION-ROADMAP.md` rather than this file turned up three clauses
that were never met — and they are the ones Stage 4 depends on, because "prove
the platform" is a test of exactly these seams.

**Stage 2 wanted the contract to express a badge.** It did not. `TAppManifest`
now carries `useBadge` and `usePowerKCommands`.

Both are hooks, which is the only shape that works — a count has to poll and
re-render, and a static object cannot. That creates a Rules-of-Hooks problem:
`apps.map((app) => app.useBadge?.())` calls a *different number of hooks* as
permissions resolve, which corrupts React's hook order. `core/apps/contributions.ts`
iterates `getRegisteredApps()` instead — a module-level constant, fixed length
from import time. The price is that a hidden app's hooks still run, which is why
the contribution context carries `isVisible` and both contracts say in as many
words to do nothing when it is false.

**Stage 2's "Done when" included publishing and receiving an event.** Nothing in
the repo had ever called `publishAppEvent` — not chat, not the `hello`
placeholder. Chat now publishes `chat:message.created` (once the *server* accepts
the send; an optimistic local row is not an event, it may still fail) and
`chat:room.opened`. The rail badge subscribes to both.

That is a real use, not a demo: it is what lets the badge sit on a
thirty-second poll and still clear the instant you read a room. Neither side
knows the other — chat has never heard of the rail, the rail has no idea what a
room is.

**Stage 3 wanted unread counts on the rail icon and conversations in the
palette.** Both now exist, fed by one new endpoint.

- `GET /chat/overview/` returns `{unread: {total, mentions}, rooms: [...]}`.
  Deliberately not `/chat/rooms/`: that returns whole rooms — every member, the
  last message, its reactions — and polling it from the rail on every page in the
  product to draw a number would be the worst request in the shell.
- **The badge and the conversation list share `mentions_me_q`** rather than each
  deciding what a mention is. A badge that counts differently from the room list
  is a red dot with nothing behind it, and people stop trusting that badge
  permanently.
- **Mentions are emphasised, not just counted.** Eleven unread and one addressed
  to you by name are different facts; a rail that renders them identically
  teaches people to ignore both.
- **One poll, two consumers.** `useChatOverview` caches at module scope and
  shares a single in-flight request, because the badge and the palette mount
  independently and neither is inside `ChatProvider` — which only exists while
  chat is open, which is exactly when a badge about chat stops mattering.
- **Palette rooms are ordered most-recently-active** and capped at 50. A jump
  list is for the conversation you were just in.

**Migration**: none. No schema change.

### 5. Tests written, not run

Django, DRF, `anthropic` and `openai` are not installed on the host, so pytest
needs the container.

- `plane/tests/unit/views/test_chat_agent.py` — SSE framing, history
  sanitisation, provider dispatch, the anti-buffering headers.
- `plane/tests/contract/app/test_chat_agent_app.py` — the endpoint end to end
  with the provider mocked: both error contracts, both modes, transcript
  fencing, clamping.
- `plane/tests/unit/bg_tasks/test_chat_scheduled_task.py` — the release sweep,
  including the `updated_at` bump the whole thing exists for.
- `plane/tests/contract/app/test_chat_user_group_app.py` — mention groups: handle
  rules, reserved handles, the admin-only writes, the group-row touch on both an
  add and a removal, and the unread badge counting a group mention.
- `plane/tests/contract/app/test_chat_overview_app.py` — the badge's arithmetic:
  your own messages, read messages, queued messages, tombstones and archived
  rooms all counting for nothing, and all three kinds of mention counting for
  one.

**What was actually run**, in two standalone harnesses that need neither Django
nor a browser:

- The dependency-free half of `agent.py`, loaded out of the module with `ast` —
  **30 checks, all passing**: SSE framing (including a newline inside a delta,
  which would end a frame early if deltas were not JSON-encoded), the mid-stream
  error frame, history sanitisation and alternation, the system prompts.
- The handle contract, with both regexes read out of the real source so it fails
  if either side is edited alone — **37 checks, all passing**: every handle the
  server accepts survives being written as `<!handle>` and read back by the
  client's tokeniser, every client broadcast handle is reserved server-side, and
  every handle the editor suggests from a name is one the server accepts.
- `joinUrlPath`'s actual behaviour, run rather than read — it returns
  `new URL(...).pathname`, so **a query string is dropped**. That is why chat's
  palette commands call `router.push` directly instead of going through
  `handlePowerKNavigate`; routed through it, every room jump would have landed on
  whichever conversation chat opens by default.

Beyond that: `tsc --noEmit` over `apps/web` is clean, every changed Python file
byte-compiles, and `oxlint` reports 0 errors across the changed TypeScript.

`oxfmt --check` fails on both changed TypeScript files — but it also fails on
those files as they are on `main`, so this is the ported code disagreeing with
the repo's formatter, not the change. Running it would rewrite thousands of
unrelated lines.

---

## Remaining actions

### 1. Open chat in a browser — THE remaining unknown

```bash
docker compose -f KIRAN-MGMT-main/docker-compose-local.yml up -d
```

```bash
docker start -a kiran-mgmt-main-migrator-1
```

```bash
cd KIRAN-MGMT-main && pnpm --filter web dev
```

The migrator run matters now: migrations 0125 and 0126 are new.

Then `http://localhost:3000` — **not** `127.0.0.1`, the API's CORS allowlist only
has the `localhost` forms. Sign in as `admin@kirancableppl.com` / `KiranDemo!2026`.

Click **Chat** in the left rail. What to check, in the order things are most
likely to break:

1. **Does it render at all?** If the pane is blank, it is the store's boot
   effect — `core/apps/chat/store/chat-store.tsx`, the `bootstrapChat` call.
   Browser console first.
2. **Is the conversation list populated?** If rooms load but the member list is
   empty, the workspace member store had not fetched yet when chat mounted.
3. **Send a message.** The whole optimistic-update path: local row appears
   immediately, `POST` fires, the row adopts the server id, the tick goes solid.
4. **Open a second browser as a different user and check the poll.** Messages
   within ~3 seconds. The only test of the real-time path.
5. **Ask the agent something.** With no LLM configured it should say "AI is not
   configured for this instance" in a dismissible bubble, not hang. With one
   configured, text should appear progressively — if it arrives in one lump, the
   anti-buffering headers are being stripped somewhere.
6. **Schedule a message a minute out, then refresh the tab.** It must still be
   in the scheduled list, and it must arrive without the tab being open. This is
   the one thing that cannot be checked without the worker and beat running.
7. **Create a mention group, then type `@` in the composer.** The handle should
   appear in the autocomplete under the people. Send a message mentioning it as
   someone in the group and the room's badge should count it as a mention, not
   just a message.
8. **Leave chat, and check the rail icon.** With unread messages there should be
   a count on it; with a mention among them it should be red rather than grey.
   Open the room and it should clear within a second — that is the event channel
   working, not the poll.
9. **Open Power-K and type a room name.** The conversation should be there with
   its unread count, and picking it should land you *in that room* — if it lands
   on chat's default conversation, the query string is being stripped somewhere.
10. **Styling.** Compare against the standalone app in
    `CHATROOM-FINAL-main/nexus-chat`.

### 2. Still missing or stubbed

| Thing | State | Effort to finish |
| --- | --- | --- |
| **Presence** (online dots) | Everyone reports offline. Nothing publishes a heartbeat, and green dots that mean nothing are worse than grey ones. | Needs the websocket service, or a polled heartbeat. |
| **Attachments** | Endpoint is wired (`CHAT_ATTACHMENT` entity type added, mime allowlist widened past images), but the upload path has never been run. | Unknown until tested. |
| **Chat i18n** | 22 strings still in `core/apps/chat/lib/i18n.tsx` rather than `@plane/i18n`. Reads the shell's locale, so there is one language control. | Moving them means translating into 18 locales or `sync:check` fails. |

### 3. Decisions worth revisiting before this merges

**Re-registering Tailwind defaults.** KIRAN's design system does not extend
Tailwind, it replaces it — `variables.css` opens with `--color-*: initial`,
`--text-*: initial`, `--shadow-*: initial`. The chat components use `text-sm` 100
times, `text-xs` 66 times, `shadow-sm` 28 times. I re-registered exactly the
entries chat needs. It is additive and changes no existing pixel, but `text-sm`
now resolves everywhere in `apps/web`, so someone can bypass the design system
outside chat. Tailwind v4's `@theme` is a global registry and cannot be scoped, so
there is no version of this that avoids the leak. The alternative is rewriting
every className across ~5000 lines — a rewrite wearing a port's clothes. Reasoning
is in the header of `core/apps/chat/styles.css`.

**Polling instead of websockets.** `GET /chat/updates/?since=` every 3 seconds.
Production runs UvicornWorker, where sync views share one executor thread, so a
long-lived SSE response would stall a worker; `GZipMiddleware` buffers streaming
bodies anyway; and `apps/live` has never bound its port. The client only knows
about `/updates/`, so swapping this later is one file. The AI endpoint streams
despite all of this, and the distinction is in its module docstring.

**shadcn vendored next to propel.** Nine of its 44 components, under
`core/apps/chat/ui/`, scoped to chat. The chat components were written against
shadcn's API; moving them onto propel is a rewrite, not a port.

**Room creation is async.** `openDirect`, `createGroup`, `createGroupDm` return
`Promise<RoomId>`. Everywhere else the local update lands first and the request
follows, but here the next thing that happens is navigation into the room, and a
locally-invented id means every later write addresses a row the server has never
heard of.

### 4. Not started

- **Stage 4** — a third app to prove the contract is cheap, and cross-app links
  (a chat message referencing a work item).
- **Project-management features** — reminders, weekly reports, time tracking,
  cost tracking, cross-department linking.
- **Neon** — nothing needed. The API already reads `DATABASE_URL`; pointing it at
  Neon moves chat with everything else. There is no second connection string.

---

## Files, if you need to find something

```
apps/web/core/apps/                    the module system
  types.ts registry.ts use-apps.ts     the contract
  contributions.ts                     badge + palette collection; read the
                                       header before touching the hook loop
  routes.ts                            build-time route contributions
  power-k-commands.ts rail-provider.tsx error-boundary.tsx events.ts
  chat/                                the chat app, self-contained
    manifest.tsx routes.ts shell.tsx workspace.tsx join.tsx
    components/   24 ported components + MentionGroupsDialog
    ui/           9 vendored shadcn components + tokens.css
    lib/          pure helpers: mentions, time, pagination, slash commands
    contributions.ts                 what chat puts on the rail and in Power-K
    services/     chat.service.ts (HTTP), wire.ts (snake_case <-> camelCase)
                  overview.ts (the shared poll behind the badge)
    store/        chat-store.tsx, connector.ts (boot + poll), transport.ts
    styles.css    the design tokens — read the header before changing it
  hello/                               the registry's test case; delete once
                                       a third real app has landed

apps/api/plane/
  db/models/chat.py                    8 models
  db/migrations/0124_...               applied
  db/migrations/0125_...               NOT applied — the release index
  db/migrations/0126_...               NOT applied — the mention group tables
  app/serializers/chat.py
  app/views/chat/                      room.py message.py invite.py updates.py
                                       agent.py     <- the AI endpoint
                                       group.py     <- mention groups
                                       overview.py  <- the shell's view of chat
  app/urls/chat.py                     20 routes
  throttles/chat.py                    the AI rate limit
  bgtasks/chat_scheduled_task.py       the release sweep (beat, every minute)
  tests/unit/views/test_chat_agent.py
  tests/unit/bg_tasks/test_chat_scheduled_task.py
  tests/contract/app/test_chat_agent_app.py
  tests/contract/app/test_chat_user_group_app.py
  tests/contract/app/test_chat_overview_app.py

MODULES.md                             how to add app number three
```
