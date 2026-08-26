# Database connectors

**Where the key goes.** Both KIRAN applications read their database connection
from configuration. Nothing is hardcoded, and switching to a managed Postgres
such as Neon is an edit to two `.env` files, not a code change.

- **Version** 1.0 — 26 August 2026
- **Related** [INTEGRATION-ROADMAP.md](INTEGRATION-ROADMAP.md) (Stage 1),
  [DESIGN.md](DESIGN.md)

---

## The short version

| I want to… | Do this |
| --- | --- |
| Run everything locally | Nothing. The defaults point at Docker Postgres. |
| Move the project app to Neon | Replace `DATABASE_URL` in `apps/api/.env`. See [§2](#2-project-management-appsapi). |
| Move chat to a real backend | Nothing yet — chat's backend lands in Stage 3. The switch is already wired: see [§3](#3-chat-nexus-chat). |

Chat has no database connection of its own, and is not going to get one. It
talks to `apps/api`, which owns the only connection string in the platform.
Point that one at Neon and chat's data moves with it. This is deliberate: a
second connection string would mean a second copy of the authentication,
workspace and role rules to keep in step, and those drift.

---

## 1. The shape of it

```
                    ┌────────────────────────┐
   nexus-chat ─────▶│      apps/api          │─────▶  Postgres
   (browser)   HTTP │  Django · DATABASE_URL │         (Docker, or Neon)
                    └────────────────────────┘
   apps/web   ─────▶          ▲
   (browser)   HTTP ──────────┘
```

One connection string. Two front ends. Chat reaches the database the same way
the project app already does.

---

## 2. Project management (`apps/api`)

### The variable

`DATABASE_URL` in `apps/api/.env`. **When it is set it wins outright** — the
`POSTGRES_USER` / `POSTGRES_HOST` / … block below it is ignored entirely. It is
parsed by `dj_database_url` in `plane/settings/common.py`.

The local default, which needs no editing:

```
DATABASE_URL=postgresql://plane:plane@plane-db:5432/plane
```

### Switching to Neon

Neon gives you **two hostnames for the same database**. They are not
interchangeable, and using the wrong one is the usual cause of a stack that
boots fine and then fails under load, or migrations that hang.

| | Host | Use for |
| --- | --- | --- |
| **Pooled** | `ep-xxxx`**`-pooler`**`.<region>.aws.neon.tech` | the running app |
| **Direct** | `ep-xxxx.<region>.aws.neon.tech` | migrations only |

The pooled host goes through Neon's PgBouncer, which is what makes many
short-lived connections cheap — and short-lived connections are exactly what
Django, gunicorn and celery produce. The direct host has no pooler, which is
what `manage.py migrate` needs: DDL and advisory locks have to stay on one
backend for the whole transaction, and running migrations through a
transaction-mode pooler can deadlock or half-apply.

`sslmode=require` is mandatory. Neon refuses unencrypted connections and the
error it returns does not say so clearly.

**Paste the pooled string into `apps/api/.env`:**

```
DATABASE_URL=postgresql://<user>:<password>@ep-xxxx-pooler.<region>.aws.neon.tech/<db>?sslmode=require
DATABASE_URL_DIRECT=postgresql://<user>:<password>@ep-xxxx.<region>.aws.neon.tech/<db>?sslmode=require
```

`DATABASE_URL_DIRECT` is not read by anything automatically. It is stored there
so the migration command below has somewhere to copy from.

### The three connection knobs

These only apply when `DATABASE_URL` is set. They exist because a pooled
connection needs different values from a direct one, and getting them wrong
fails at runtime rather than at boot — which is the expensive kind.

| Variable | Direct host | **Pooled host** | Why |
| --- | --- | --- | --- |
| `CONN_MAX_AGE` | `60` is fine | **`0`** | Persistent connections pin a pooler slot per worker and exhaust the pool. |
| `DB_DISABLE_SERVER_SIDE_CURSORS` | `0` | **`1`** | A transaction-mode pooler can hand the next statement a different backend, at which point a server-side cursor opened by Django's `.iterator()` no longer exists. |
| `DB_CONN_HEALTH_CHECKS` | `1` if `CONN_MAX_AGE > 0` | `0` | Only meaningful for reused connections. |

The failure mode of getting `DB_DISABLE_SERVER_SIDE_CURSORS` wrong is worth
naming, because it does not show up in testing: an intermittent
`cursor "_django_curs_..." does not exist` on list endpoints, under load only.

So, for Neon pooled:

```
CONN_MAX_AGE=0
DB_DISABLE_SERVER_SIDE_CURSORS=1
DB_CONN_HEALTH_CHECKS=0
```

### Running migrations

Migrations go through the **direct** host, the app through the pooled one. Run
them with the direct string overridden for that command only:

```bash
docker compose -f docker-compose-local.yml run --rm \
  -e DATABASE_URL="postgresql://<user>:<password>@ep-xxxx.<region>.aws.neon.tech/<db>?sslmode=require" \
  migrator ./bin/docker-entrypoint-migrator.sh --settings=plane.settings.local
```

### Checking it worked

```bash
docker exec kiran-mgmt-main-api-1 python -c "import os,django;os.environ.setdefault('DJANGO_SETTINGS_MODULE','plane.settings.local');django.setup();from django.conf import settings as s;from django.db import connection as c;d=s.DATABASES['default'];print(d['HOST'],d['NAME'],'CONN_MAX_AGE',d['CONN_MAX_AGE'],'SSC_DISABLED',d['DISABLE_SERVER_SIDE_CURSORS']);c.ensure_connection();print('connected')"
```

It should print your Neon host and `connected`.

---

## 3. Chat (`nexus-chat`)

### What exists today

Chat currently has no backend at all. Every room, message and user is a fixture
in `src/lib/chat-seed.ts`, held in React state and mirrored to `localStorage`.

Stage 1 did **not** change that, and did not implement chat persistence. What it
added is the **seam**: the store no longer knows where its state lives. It asks
a `ChatConnector` to load, save and notify, and one of two implementations
answers.

| File | Role |
| --- | --- |
| `src/lib/chat-connector.ts` | The interface, and the env-var selector |
| `src/lib/chat-connector-local.ts` | localStorage — the existing demo behaviour, moved not rewritten |
| `src/lib/chat-connector-api.ts` | HTTP client against `apps/api` |

### The variables

In `nexus-chat/.env` (copy from `.env.example`):

| Variable | Values | Meaning |
| --- | --- | --- |
| `VITE_CHAT_CONNECTOR` | `local` (default) / `api` | Which implementation to build with. |
| `VITE_API_BASE_URL` | e.g. `http://localhost:8000` | Origin of `apps/api`. Empty means same origin. |
| `VITE_CHAT_WORKSPACE_SLUG` | e.g. `acme` | Which KCMS workspace chat is scoped to. |

Anything other than exactly `api` selects `local`, deliberately — a typo in an
env var should leave a working app rather than an empty one.

With `VITE_CHAT_WORKSPACE_SLUG` empty the API connector makes no request at
all, rather than guessing at a workspace.

### Switching to `api` today

You can, and it is safe, but it is not yet useful. `apps/api` serves no `/chat/`
routes until Stage 3. The connector probes for them, prints one line in the
console naming the missing endpoint, reports `ready: false`, and falls back to
seed data with saving disabled. Chat still opens and still works — a missing
backend must never be a blank screen.

You can see which connector a session is using by hovering the
online/offline indicator in the chat top bar. Its tooltip carries a
`Data: …` line.

### The endpoints Stage 3 will implement

All workspace-scoped, all session-authenticated:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/workspaces/<slug>/chat/snapshot/` | Load state. `204` means "workspace exists, no history". |
| `PUT` | `/api/workspaces/<slug>/chat/snapshot/` | Persist state. |
| `GET` | `/api/workspaces/<slug>/chat/events/` | SSE stream of changes from other sessions. |
| `GET` | `/api/workspaces/<slug>/chat/health/` | Reachability probe. |

**The snapshot shape is a Stage 1 convenience, not a commitment.** It is
snapshot-shaped because that is exactly what the store does today, and matching
it is what makes this a seam rather than a rewrite. A real server will not want
the whole workspace PUT at it on every keystroke, so Stage 3 is expected to
widen `save()` into incremental operations. That is a cheap change: the store is
the interface's only caller.

### CORS

Requests carry `credentials: "include"`, because KCMS authenticates with a
session cookie. Two consequences:

1. Chat's origin must be listed in `CORS_ALLOWED_ORIGINS` in `apps/api/.env`,
   or the browser blocks every request before it reaches Django.
2. **Use `http://localhost:…`, never `http://127.0.0.1:…`.** The allowlist
   contains only the `localhost` forms. Loading the app on the `127.0.0.1`
   origin gets every API call blocked, and the symptom is a UI that looks
   broken rather than an obvious CORS error.

---

## 4. Switching back

Both directions are a one-line revert.

- **Project app:** restore the local `DATABASE_URL` in `apps/api/.env` and
  restart the API container. Nothing else holds state.
- **Chat:** set `VITE_CHAT_CONNECTOR=local` and restart the dev server. The
  local connector still uses the original `nexus-chat-demo-v1` storage key and
  the same schema migration path, so any snapshot already in a browser loads
  unchanged.

---

## 5. Things that will bite

| Symptom | Cause |
| --- | --- |
| `KCMS didn't start up correctly!` in the UI | App loaded on the `127.0.0.1` origin; only `localhost` is in `CORS_ALLOWED_ORIGINS`. |
| Migrations hang or half-apply on Neon | Run through the pooled host. Use the direct one. |
| Intermittent `cursor ... does not exist` under load | `DB_DISABLE_SERVER_SIDE_CURSORS=0` against a pooled host. |
| Pool exhausted after a while on Neon | `CONN_MAX_AGE > 0` against a pooled host. |
| Neon connection refused with an unhelpful error | Missing `?sslmode=require`. |
| Chat shows seed data with `VITE_CHAT_CONNECTOR=api` | Expected until Stage 3. Check the console for the `[chat]` line naming the endpoint. |
| Chat makes no requests at all with `api` selected | `VITE_CHAT_WORKSPACE_SLUG` is empty. |
