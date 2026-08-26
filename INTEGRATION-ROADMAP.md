# KIRAN Platform — Integration Roadmap

**The job:** merge the chat app and the project-management app into one
application, built so further apps can be plugged in later by other people.

**Not in this plan:** PACT/SAP integration, and the business modules from
Scope.pdf (Sales & Dispatch, Accounts, Purchase, Marketing/RFQ). Those come
later and are explicitly out of scope here. This roadmap exists to make them
*cheap when they arrive*, not to build them now.

- **Version** 3.0 — narrowed to the integration itself
- **Updated** 26 August 2026
- **Related** [DESIGN.md](DESIGN.md)

---

## Success criteria

1. One app. Chat and project management both reachable from a single shell, via
   an icon in the rail.
2. Both connect to a database through a **configurable connector** — you supply
   the Neon key, nothing is hardcoded.
3. A third module can be added by another team **without editing the shell**.
4. Chat is production quality, not a demo.
5. Project-management features continue to work, with some brought up to date.

The real test of #3: adding module three should be a registration plus a
package, not a pull request that touches shell internals.

---

## What we are deliberately NOT building yet

Worth stating, because it is easy to over-build a platform for modules that do
not exist:

- **No approvals engine.** Scope.pdf needs one eventually. Not now.
- **No escalation/reminder engine.** Same.
- **No ERP adapter.** PACT is out; there is no test environment and no client
  instance.
- **No email ingestion.** Belongs with Marketing/RFQ.
- **No AI assistant.** Needs a cross-module data layer that has nothing to read
  yet.

What we *do* build is the **contract**, with room for these to be added as
platform services later without breaking existing modules. Extension points,
not implementations.

---

## Stage 1 — Baseline and open connectors

**Prompt:**

> Get the KCMS shell to a verified baseline and make the database connection
> configurable in both applications, so a Neon Postgres key can be supplied
> without code changes.
>
> **Connectors:**
> 1. Project app: `apps/api` already reads `DATABASE_URL` via `dj_database_url`.
>    Make this the documented, primary path. Add a clearly commented
>    `DATABASE_URL` placeholder to `apps/api/.env.example` with a note that
>    Neon's **pooled** (`-pooler`) host is for the app and the **direct** host is
>    for migrations, that `sslmode=require` is needed, and that `CONN_MAX_AGE`
>    must be `0` when using the pooler.
> 2. Chat app: it currently has **no backend at all** — every message, room and
>    user is a seeded fixture in `chat-store.tsx`. Introduce a data-access
>    interface behind which the existing mock store sits unchanged, plus a
>    Postgres-backed implementation selected by an env var. Nothing should
>    change visually; this is purely a seam so the key can be attached later.
> 3. Document both in a short CONNECTORS.md: which env vars, which endpoints,
>    how to switch between mock and real.
>
> **Shell quality:**
> 4. Verify the KIRANOS retheme *inside* the signed-in app — boards, issue list,
>    spreadsheet, kanban, gantt, issue detail, settings, modals. Only the
>    sign-in page has ever been verified. Watch dense views for blur bleeding
>    into rows and scroll jank.
> 5. Fix the propel Button defect: primary buttons render with disabled colours
>    while genuinely enabled. Repro in DESIGN.md.
> 6. Visually check `light-contrast` and `dark-contrast`.
> 7. Make the `packages/i18n/locales` junction survive a fresh checkout. Today a
>    re-extract silently blanks every string in the UI.
>
> Do not start module work in this stage. Do not implement chat persistence —
> only the seam.

### Stage 1 checklist

Decisions taken 26 Aug 2026: Neon is **placeholders only** for now — local Docker
Postgres stays the default and the key gets pasted later. Chat's remote
connector talks to **the Django `apps/api`**, not to Postgres directly, so
Stage 3 inherits KCMS auth, workspaces and roles rather than duplicating them.

**Connectors**

- [x] 1.1 `apps/api` — `DATABASE_URL` documented as the primary path, with a
      Neon-annotated placeholder in `.env.example` (pooled vs direct host,
      `sslmode=require`, `CONN_MAX_AGE=0`). Also exposed
      `DB_DISABLE_SERVER_SIDE_CURSORS` and `DB_CONN_HEALTH_CHECKS`, which a
      pooled host needs and which previously had no way in.
- [x] 1.2 Chat — `ChatConnector` interface with the existing localStorage store
      behind it unchanged, plus an `apps/api` HTTP implementation selected by
      `VITE_CHAT_CONNECTOR`. Verified live: real workspace-scoped requests,
      Django 404s them, connector degrades to seed data with one console line.
      18 new tests; chat suite 135/135; tsc and eslint clean.
- [x] 1.3 `CONNECTORS.md` — env vars, endpoints, how to switch mock ↔ real

**Shell quality**

- [~] 1.4 Retheme verified signed-in, by measuring the live DOM with transitions
      settled. **Zero text-contrast failures** in every view measured so far:

      | View | Scale | light | dark | light-contrast | dark-contrast |
      | --- | --- | --- | --- | --- | --- |
      | Sign-in / pre-auth | 12 nodes | 0 | 0 | 0 | 0 |
      | Work-item spreadsheet | 60 rows, 63 nodes | 0 | 0 | 0 | 0 |
      | Kanban | 144 cards, 197 nodes | 0 | 0 | — | — |
      | Gantt | rendered | 0 | 0 | — | — |

      Also zero `backdrop-filter` on any row, card or bar in all of them, so the
      "glass on chrome only" rule holds in practice and nothing bleeds into
      dense content. No horizontal overflow anywhere.
      **Still to cover:** issue detail, settings, modals.
      **Caveat that does not go away:** this pane never composites
      (`document.hidden === true`), so this is colorimetric and structural
      verification, not a visual sign-off. It reliably catches contrast, glass
      and layout-overflow defects; it cannot catch spacing, alignment or
      anything purely aesthetic. See §10.1 of DESIGN.md for why.
- [x] 1.5 propel Button — **not a defect.** The CSS is correct; the reported
      symptom was a frozen animation timeline in a hidden browser pane.
      Confirmed by the user in a real browser. Recorded as a measuring rule in
      DESIGN.md §10.1 and guarded by 36 new tests in `packages/propel`.
- [x] 1.6 `light-contrast` / `dark-contrast` — **were inert, now real.** Both
      overrode only `--border-*` (14 properties each) and zero text/background
      tokens, so every ratio was identical to plain light/dark. Verified twice
      before the fix, statically and live. User asked for both the audit fix and
      real themes, so they now carry 32 + 11 `--txt-*` and 11 + 2 `--bg-*`
      overrides. Measured live across 404 rendered text nodes per theme:

      | theme | failures | worst pair on page | `--txt-primary` on canvas |
      | --- | --- | --- | --- |
      | light | 0 | 4.59 | 15.12 |
      | dark | 0 | 6.70 | 16.08 |
      | light-contrast | 0 | **6.91** | 16.66 |
      | dark-contrast | 0 | **7.50** | 18.47 |

      The contrast themes now measurably beat their base themes instead of
      matching them, and primary text clears AAA in both.
- [x] 1.7 Make the `packages/i18n/locales` junction survive a fresh checkout

### Defects found and fixed

- **Ink hardcoded on a themed fill** (4 sites). `text-white` / `color: white` on
  `bg-accent-primary`, which is a *light* blue in dark mode — measured 2.54:1
  against a 4.5 requirement. Fixed to `text-on-color` in
  `ai-assistant/index.tsx` (×3) and `packages/editor/src/styles/editor.css`.
  Now 4.59:1 light / 7.91:1 dark. All four themes measure zero text failures on
  the spreadsheet view.

Beyond the four ink fixes above, all of these were found, fixed and verified live:

| What | Where | Proof |
| --- | --- | --- |
| `kx-ambient` applied **twice**, nested — against glass.css's own "applied once at the application root" contract. Doubled the `will-change` compositing layers and infinite drift animations directly behind every dense scroll container. | `content-wrapper.tsx` (root kept) | live count 2 → **1** |
| Dark `--bg-danger-primary` pointed at the *dark* end of the red ramp while success/warning used the light end. Dark ink on it measured 2.40:1 — and the comment beside it already claimed 6.94:1. | `variables.css` dark block | **2.40 → 6.94** |
| DESIGN.md §9's global `prefers-reduced-motion` block did not exist anywhere. Only the two ambient orbs were gated. | `animations.css` | block added; uses 0.01ms not 0, so `transitionend` listeners still fire |
| ~22 icon-only buttons with no accessible name. | 16 sites across nav/sidebar/headers | a11y tree now reads "Open user menu", "Collapse sidebar", "Toggle quick actions menu", etc. Layout switcher also got `aria-pressed`. |
| `<Button variant="link">` never got its `px-0` — cva emitted both `px-0` and the size's `px-2`, and tailwind-merge kept `px-2`. | `propel/src/button/helper.tsx` | fixed via `compoundVariants`; **124 tests**, proven non-vacuous by two deliberate breakages |

### Defects found, recorded, NOT fixed

| # | What | Where |
| --- | --- | --- |
| A | **Base `dark`** `--bg-accent-primary-hover`/`-active` are dark fills under near-black ink — a primary button's own label reads **2.77:1 on hover, 2.29:1 on press**. Same class as the danger bug. Fixed inside `dark-contrast` only; base dark still ships it. | `variables.css` dark block |
| B | Base `light` pre-existing failures untouched because fixing a shipped theme is a visible change: `--txt-disabled` 2.75–3.02, on-color on success 3.11 and warning 2.06, link/accent on canvas 4.32. | `variables.css` light block |
| C | Nested `<button>` inside `<button>` — `CustomMenu` wraps `customButton` in its own button, so menu triggers and their options appear **twice** in the accessibility tree. Invalid HTML. | `packages/ui` `CustomMenu` + consumers |
| D | Per-row cost in dense views: `transition-all` on gantt bars and kanban cards, a scroll-toggled per-row box-shadow in the spreadsheet using a hardcoded `rgba()`. | `issue-layouts/**`, `gantt-chart/**` |
| E | ~94 untokenised hex literals, mostly duplicated status/priority colour maps that have drifted apart across four files. | `apps/web`, `packages/propel/src` |
| F | Two dead workarounds for the `link` padding bug, now redundant and masking future changes: `!p-0` and a `p-0` that only applies when disabled. | `project/card.tsx`, `existing-issues-list-modal.tsx` |

### Good news, verified rather than assumed

- **Glass is on chrome only.** Zero `backdrop-filter` anywhere in spreadsheet,
  kanban, list, gantt, calendar or issue detail — confirmed by source audit and
  by measuring the live DOM across 61 rendered rows. No blur bleeding into rows.
- **No horizontal overflow** and **no blank i18n strings** in the signed-in app,
  so the locales fix in 1.7 is doing its job.

**Done when:** both apps take a connection string from configuration, the shell
is verified signed-in with no known visual defects, and CONNECTORS.md tells the
user exactly where to paste their key.

---

## Stage 2 — The module system

The stage that decides whether module three is cheap. Keep it lean — contract
and extension points, no speculative services.

**Prompt:**

> Build the module system for the KCMS shell. No business logic, and no chat
> code — design the contract independently, then prove it with a placeholder.
>
> **Contract.** A module declares: id, display name, icon, the route namespace
> it owns, a mount component, permission requirements, and optional
> contributions to shared surfaces (rail icon, command palette entries,
> unread/badge count).
>
> **Build:**
> 1. A module registry — adding a module is a registration, never an edit to
>    shell internals.
> 2. Shell routing that hands `/<workspaceSlug>/m/<moduleId>/*` to a module and
>    stops caring what happens inside.
> 3. A switcher in the existing app rail: one icon per module, active state,
>    keyboard reachable, plus command-palette entries. Follow DESIGN.md — the
>    rail is already glass chrome.
> 4. A module context giving each module the signed-in user, workspace, theme,
>    i18n and its data connector, so modules never reach into shell internals.
> 5. A lightweight event channel modules can publish to and subscribe to. Keep
>    it deliberately small — this is the seam that approvals, escalations and
>    notifications will hang off later. Do not build those now.
> 6. A placeholder "Hello Module" using nothing but the contract.
>
> **Constraints:** modules lazy-load, so an unused module costs nothing at
> startup; a module that fails to load must not take down the shell; the
> contract must not assume a module has a backend, since some will not.
>
> Write MODULES.md: the contract, and a worked "add a module from scratch"
> example good enough for another team to follow without reading shell source.

**Done when:** the placeholder mounts from the rail, lazy-loads, survives a
forced error without killing the shell, publishes and receives an event, and
MODULES.md is sufficient for someone else to add module three unaided.

---

## Stage 3 — Chat as the first module, production quality

**Prompt:**

> Bring nexus-chat into the KCMS shell as the first real module, implementing
> the Stage 2 contract. If the contract cannot express something chat needs,
> change the contract deliberately and record why — do not special-case chat.
> Coordinate with the backend engineer on schema before building it.
>
> **Interface.** Move chat into the monorepo as a workspace package. Remove its
> TanStack Start routing and app shell — the KCMS shell owns URL, page frame,
> theme and top bar. What survives is the conversation list, message thread,
> composer and supporting components. Delete chat's own token layer so it renders
> on the shell's Canvas/Surface/Layer tokens and inherits all five themes. The
> palettes are already identical, so no colour should change; if one does, the
> port is wrong.
>
> **Identity.** Replace the demo user switcher with the real signed-in user. Map
> chat participants onto real workspace members.
>
> **Persistence.** Implement the Postgres side of the Stage 1 connector: rooms,
> messages, membership, read state, reactions, threads, attachments — scoped to
> workspaces and honouring existing roles. Real-time delivery (RabbitMQ and the
> `live` service already exist). Migrations, permissions and tests to the
> standards already used in `apps/api`.
>
> **Platform wiring.** Contribute unread counts to the rail icon and
> conversations to the command palette. Publish message events to the Stage 2
> event channel — that is what later lets escalations and approvals surface in
> chat without chat needing to know about them.
>
> **Known chat defects** — fix or consciously defer, do not port silently: the
> right-hand context panel is unreachable at desktop widths; `@engineering` and
> `@here` render as raw tokens; its brand gradient fails contrast with white
> text (DESIGN.md carries a corrected one).
>
> Out of scope here: commitment detection, AI assistant, escalations.

**Done when:** chat opens from the rail icon, persists to the configured
database, delivers in real-time between two signed-in users, themes correctly in
all five themes with no chat-specific CSS, and publishes to the event channel.

---

## Stage 4 — Prove the platform, refresh project management

**Prompt:**
>
> **Part A — prove modularity.** Build a third module. It can be small — a
> personal chatbot page or a simple analytics view is enough. What matters is
> *measuring the cost*: track how much of the work was module logic versus
> fighting the shell. Anything in the second category is a contract defect —
> fix it in the contract, not the module, and update MODULES.md. If this module
> is not markedly cheaper than chat was, Stage 2 was wrong and this is where we
> find out.
>
> **Part B — project management refresh.** With the shell settled, bring the PM
> side up to date. Confirm with the user which features matter most; from
> Scope.pdf the project-management candidates are: automatic linking of projects
> across departments, time allocation per employee/project, cost tracking,
> scheduled weekly reports, and task reminders. Build only what is asked for,
> using the module contract like any other module.
>
> **Part C — cross-module links.** Now that two real modules exist, make them
> reference each other: a chat message linking to a work item, a work item
> showing its related conversation. This is the first genuine test of whether
> modules can cooperate without coupling.

**Done when:** module three exists and was cheaper to build than chat; the
agreed PM features work; and a chat message and a work item can link to each
other through the contract rather than direct imports.

---

## Decisions needed

| # | Decision | Needed by |
| --- | --- | --- |
| 1 | Neon connection strings (pooled + direct). Migrate existing data or start clean? | Stage 1 |
| 2 | Chat schema — do you design it, or your backend engineer? Two people designing it separately is the expensive failure. | Stage 3 |
| 3 | What is module three? Naming it early keeps Stage 2 honest — designing against one known module invites accidental special-casing. | Stage 2 |
| 4 | Which project-management features actually need updating? | Stage 4 |
| 5 | Does chat need to work on mobile, or desktop only? Chat's layout assumes desktop; the shell is responsive. | Stage 2 |

---

## Sequencing

Stages 1 and 2 can overlap — the contract can be designed while the shell is
stabilised. Stage 3 needs both. Stage 4 needs 3.

Stage 1's shell-verification steps need Docker. Stage 1's connector work and all
of Stage 2 do not.
