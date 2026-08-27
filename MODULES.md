# Adding an app to KIRAN

KIRAN is a shell that hosts several apps. Projects was the first, Chat is the
second, and this document is what a third one needs.

An **app** is a top-level section with its own entry in the app rail, its own
routes under `/:workspaceSlug/…`, and its own layout inside the shell's content
area. It is not a page, a tab, or a feature of a project — those live *inside*
an app.

Everything lives in `apps/web/core/apps/`.

---

## The contract

An app declares one object, `TAppManifest` (`core/apps/types.ts`):

| Field | Required | What it does |
| --- | --- | --- |
| `key` | yes | Stable id. Used in storage keys — renaming it migrates nothing. |
| `label` | yes | Rail label, and the palette title after "Go to ". Plain English. |
| `icon` | yes | Rail icon, rendered at `size-5`. |
| `path` | yes | `(workspaceSlug) => string` — where the rail entry points. |
| `matches` | yes | `(pathname, workspaceSlug) => boolean` — does this path belong to you? |
| `order` | yes | Rail order, ascending. Leave gaps. |
| `isFallback` | no | Claims every path nobody else claims. **Projects owns this.** |
| `isAvailable` | no | Role gate. Omitted means "anyone in the workspace". |
| `keySequence` | no | Command palette shortcut. Use the `a*` namespace. |
| `keywords` | no | Extra palette search terms. |
| `useBadge` | no | Live count on your rail icon. See below. |
| `usePowerKCommands` | no | Palette entries for your app's *contents*. See below. |

Three surfaces read it and need no edit when you add an app:

- **The app rail** (`core/components/navigation/app-rail-hoc.tsx`)
- **The router** (`app/routes/extended.ts` → `core/apps/routes.ts`)
- **The command palette** (`core/apps/power-k-commands.ts`)

### Contributing to shared surfaces

The last two fields are hooks, not values — a badge count has to poll and
re-render, and a static manifest object cannot. The shell calls them; you never
reach into the shell.

```ts
// core/apps/directory/contributions.ts
export function useDirectoryBadge(ctx: TAppContributionContext): TAppBadge | undefined {
  const pending = usePendingApprovals(ctx.workspaceSlug, ctx.isVisible);
  if (!pending) return undefined;                       // no badge yet ≠ zero
  return { count: pending.length, emphasis: false, label: `${pending.length} pending` };
}
```

```ts
// core/apps/directory/manifest.tsx
useBadge: useDirectoryBadge,
usePowerKCommands: useDirectoryPowerKCommands,
```

**Three rules, and the first one will bite you if you skip it.**

1. **Your hooks run even when your app is hidden.** They are called once per
   *registered* app, not per visible app — `core/apps/contributions.ts` iterates
   the module-level registry because that is the only array whose length is
   guaranteed stable across renders, and a variable hook count breaks React's
   hook order. So gate every fetch on `ctx.isVisible`; the shell throws the
   result away regardless.
2. **Return `undefined` for "no badge yet", not `{count: 0}`.** Both draw
   nothing, but only the first is true while a request is in flight.
3. **Your data cannot come from your app's own provider.** The rail and the
   palette are mounted outside it. Chat's badge is driven by a small dedicated
   endpoint and a module-scope cache
   (`core/apps/chat/services/overview.ts`) — one slow poll, shared by both
   surfaces — precisely because `ChatProvider` only exists while chat is open,
   which is when a badge about chat stops mattering.

Palette commands are ordinary `TPowerKCommandConfig` objects. One trap: do **not**
route them through `handlePowerKNavigate` if your URL carries a query string. It
normalises via `joinUrlPath`, which returns `new URL(...).pathname` — the query
is dropped silently. Call `ctx.router.push()` directly instead.

### What the shell gives you

`useAppContext()` — the signed-in user, the workspace, `t()` and the router.
Read identity, workspace, locale and navigation from here rather than from
`useUser` / `useWorkspace` / `useTranslation` / `useAppRouter` directly: this
hook has a stable shape, those are shell internals that get refactored.

You are not walled off from the rest of the shell — Chat legitimately needs
workspace members, file uploads and issue detail, and hand-writing a facade for
each would be a second API surface maintained by hand. The rule is narrower:
**identity, workspace, locale and navigation come from `useAppContext`.**

### Talking to other apps

Apps must not import each other. `publishAppEvent` / `useAppEvent`
(`core/apps/events.ts`) carry facts between them, so either app can be deleted
without breaking the other.

The channel is in-memory, synchronous, per-tab, and unbuffered — a subscriber
that mounts after an event fired has missed it. Add your event names to
`TAppEventMap`; a shared vocabulary is the whole point, and two apps inventing
`message.sent` separately are not talking to each other.

A worked example, because "an event channel exists" is not the same as anyone
using it: chat publishes `chat:message.created` once the **server** has accepted
a send (an optimistic local row is not an event — it may still fail) and
`chat:room.opened` when you open a conversation. The rail badge subscribes to
both and refetches. Neither side knows the other: chat has never heard of the
rail, and the rail has no idea what a room is. Both know the event name.

That is also why the badge can stay on a thirty-second poll and still clear the
instant you read a room.

---

## Adding an app, start to finish

Say the app is **Directory**, a workspace people-finder, living at
`/:workspaceSlug/directory`.

### 1. The manifest — `core/apps/directory/manifest.tsx`

```tsx
import { UsersIcon } from "lucide-react";
import type { TAppManifest } from "../types";

export const directoryAppManifest: TAppManifest = {
  key: "directory",
  label: "Directory",
  icon: <UsersIcon className="size-5" />,
  path: (workspaceSlug) => `/${workspaceSlug}/directory`,
  matches: (pathname, workspaceSlug) => pathname.startsWith(`/${workspaceSlug}/directory`),
  order: 300,
  keySequence: "ad",
  keywords: ["people", "team", "who"],
};
```

### 2. The routes — `core/apps/directory/routes.ts`

**Build-time module.** React Router's config loader evaluates this in Node
before a browser exists. No JSX, no components, no `window`. Paths are relative
to `app/`, not to this file.

```ts
import { layout, route } from "@react-router/dev/routes";
import type { RouteConfigEntry } from "@react-router/dev/routes";

export const directoryAppRoutes: RouteConfigEntry[] = [
  layout("./(all)/[workspaceSlug]/(directory)/layout.tsx", [
    route(":workspaceSlug/directory", "./(all)/[workspaceSlug]/(directory)/page.tsx"),
  ]),
];
```

### 3. The screens — `core/apps/directory/shell.tsx`, `page.tsx`

Your `shell.tsx` renders the app's frame and an `<Outlet />`. Copy the outer
container from `core/apps/hello/shell.tsx`: the rounded border is the shell's
content area, not your chrome. Everything inside it is yours — sidebar or no
sidebar, your call.

### 4. The route files — `app/(all)/[workspaceSlug]/(directory)/`

React Router needs modules at these paths, but keep them thin so the app stays
one directory:

```tsx
// layout.tsx
export { DirectoryAppShell as default } from "@/apps/directory/shell";
export { AppErrorBoundary as ErrorBoundary } from "@/apps/error-boundary";

// page.tsx
export { DirectoryAppPage as default } from "@/apps/directory/page";
```

**The `ErrorBoundary` re-export is required.** React Router bubbles a render
error to the nearest route module that exports one. Without it that is
`app/root.tsx`, whose boundary replaces the whole document — a bug in your app
would take the rail, the top bar and Projects down with it. The shell cannot
enforce this; React Router reads the export off the route module and there is no
hook to inject one.

### 5. Register — two lines

```ts
// core/apps/registry.ts
import { directoryAppManifest } from "./directory/manifest";
const MANIFESTS: TAppManifest[] = [projectsAppManifest, helloAppManifest, directoryAppManifest];

// core/apps/routes.ts
import { directoryAppRoutes } from "./directory/routes";
export const appRegistryRoutes = inWorkspaceShell([...helloAppRoutes, ...directoryAppRoutes]);
```

### 6. Check

```bash
pnpm --filter web exec react-router typegen && pnpm --filter web exec tsc --noEmit
```

`typegen` failing means the route config is wrong. A generated
`.react-router/types/app/(all)/[workspaceSlug]/(directory)/` directory means it
worked.

That is the whole job: one directory, two registration lines.

---

## Things that will bite you

**The rail was invisible until there were two apps.** `AppRailVisibilityProvider`
takes `isEnabled` and defaults it to false; nobody passed true because Projects
was the only app. `AppRailProvider` (`core/apps/rail-provider.tsx`) now answers
from the registry. If your app is the only one a user can see, the rail stays
hidden for them — that is correct, not a bug.

**Exactly one app may set `isFallback`.** Projects has it, because the workspace
root and a long tail of screens beneath it are Projects screens, and listing
them in `matches` would be a list that goes stale. The registry throws in
development if a second app claims it.

**Key sequences: use `a*`.** `ap` Projects, `ah` Hello, `ac` Chat. The `g*` space
the rest of the palette uses is nearly exhausted and already contains
duplicates; staying out of it means you can pick a sequence without auditing
every command in the product.

**Labels are not i18n keys.** `t()` echoes back any string that is not a dotted
key path, so `label: "Directory"` renders as "Directory". This is deliberate:
routing every new app through a locale change in ten languages, gated by a
`sync:check` that fails on partial translations, is friction with no payoff for
a rail label. Swap in a real key when the app is translated.

**Lazy loading is the framework's job.** React Router code-splits route modules,
so an app the user never opens costs a manifest — an icon and a few strings —
and nothing more. Keep heavy imports inside your route modules, not in
`manifest.tsx`, or you will undo this.

---

## Deviations from the original Stage 2 plan

Recorded so the difference is a decision rather than a drift.

**No `/m/<moduleId>/*` namespace.** The roadmap proposed routing every module
under a reserved prefix. Projects already owns `/:workspaceSlug` and dozens of
paths beneath it; moving it under `/m/projects/` would break every existing URL
and every bookmark for a cosmetic gain. Apps own their own top-level path
segment instead, and `matches` is how the shell knows whose is whose.

**No `mount` component in the manifest.** Route files supply the mount point,
because React Router resolves route modules by file path at build time and a
component reference in a runtime manifest cannot be code-split by it. The
manifest declares *identity*; the route files declare *rendering*.
