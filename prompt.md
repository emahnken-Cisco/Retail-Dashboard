# Retail Dashboard — project context & AI prompt

Use this file to onboard tools or people quickly. For setup and deployment, see `README.md` and `docs/`.

---

## What this is

**Retail Operations Dashboard** — a self-hosted web app for **retail store locations** that integrates:

- **Cisco Meraki** (networks, appliances, WAN uplinks, devices, alerts, camera links, uplink usage / loss & latency history)
- **ThousandEyes** (enterprise agents + tests from ingest snapshots; endpoint agents; live test metrics for uplink latency/loss when selected)
- **OpenWeather** (site weather, optional map overlays) with a configurable daily quota
- **Carrier circuits** per site (DIA, broadband, satellite, cellular) tied to Meraki interfaces, outage tracking, local contacts

Data is stored in **PostgreSQL** (Prisma). Snapshots from Meraki and ThousandEyes are stored as **`MetricSnapshot`** rows (JSON payloads), populated by scheduled jobs.

**RBAC** — Every signed-in user has a **`UserRole`** (`ORG_ADMIN`, `LOCATION_CIRCUIT`, or `USER`). The server enforces role checks on mutating and sensitive routes; the web app mirrors visibility in the sidebar, `RoleRoute` wrappers, and read-only UI where applicable.

---

## Tech stack

| Layer | Choice |
|--------|--------|
| API | **Fastify** (TypeScript), **Zod** validation, session auth |
| DB | **PostgreSQL**, **Prisma** (`apps/server/prisma/schema.prisma`) |
| Web | **React** + **Vite**, **React Router** |
| Crypto | API secrets encrypted at rest (AES-256-GCM) in `CredentialVault` |

**Monorepo:** npm workspaces — `apps/server`, `apps/web`. Root scripts: `npm run dev`, `npm run build`, `npm run db:migrate`.

---

## Repository layout (high level)

```
apps/server/          # Fastify API, Prisma, jobs (meraki ingest, TE ingest, circuit outage recorder)
apps/web/             # React SPA
docs/                 # DEPLOYMENT, CONFIGURATION, USER_GUIDE
env.example           # Template for root .env (never commit real secrets)
```

**Important server areas**

- `src/routes/` — dashboard, sites, circuits, admin, credentials, auth, tags, **users** (admin user CRUD)
- `src/jobs/` — Meraki ingest, ThousandEyes ingest, scheduler (cron), retention
- `src/lib/` — Meraki client, ThousandEyes client, site coordinates, TE enterprise test metrics + cache, OpenWeather quota, **`rbac.ts`** (role preHandlers)

**Important web areas**

- `src/lib/roles.ts` — role types and **`canEditStores`**, **`canViewTags`**, **`canViewAdminSettings`**, **`canViewApiDebug`**, **`canClearOutboundTraces`**, etc.
- `src/auth.tsx` — session user includes **`role`**
- `src/App.tsx` — **`Private`** (any authenticated user) vs **`RoleRoute`** (allow-listed roles)
- `src/Layout.tsx` — sidebar links gated by role (Admin block, Tags, API debug, credentials)
- `src/pages/DashboardPage.tsx` — map, location grid, `SiteDetailPanel`; uses **`/api/dashboard/ui-config`** (not admin settings) so all roles can load
- `src/pages/AdminUsersPage.tsx` — org-admin user management (create/update/delete users, assign roles)
- `src/components/SiteSummaryTables.tsx` — `SiteDetailPanel`, `LocationCardSummary`, WAN/TE tables
- `src/components/UplinkHistorySidecar.tsx` — Meraki uplink traffic + latency/loss; TE enterprise test option for latency/loss
- `src/lib/sitePayloads.ts` — parsing Meraki/TE snapshot JSON for the UI

---

## Domain model (Prisma highlights)

- **`User`** — email, password hash (local auth), **`role: UserRole`** — `ORG_ADMIN` | `LOCATION_CIRCUIT` | `USER` (default for new users; migration may set existing rows to org admin)
- **`Site`** — name, `merakiNetworkId`, `thousandEyesTag`, `lat`/`lng`, **`locationLatLngManual`** (when true, stored coords win over Meraki geo for map/weather), `city`, circuit expectations (`expectWan2Healthy`, `expectCellularHealthy`), local contact fields, `displayOrder`
- **`MetricSnapshot`** — `siteId`, `source` (`meraki` | `thousandeyes` | …), `payload` (JSON), `capturedAt`
- **`Circuit`** — per-site carrier circuit, `connectivityKind`, `merakiInterface`, optional `merakiApplianceSerial`, speed preset, `siteLocalContactSlot`, etc.
- **`CircuitOutageEvent`** — derived from Meraki ingest when an interface becomes unhealthy
- **`CircuitSpeedPreset`** — reusable download/upload tiers
- **`CredentialVault`** — one row per provider (`meraki`, `thousandeyes`, `google_maps`, `openweathermap`)
- **`AdminSettings`** — lenses (show Meraki/TE/map, card columns, map weather), poll intervals, OIDC, OpenWeather daily limit, etc.

**Migrations:** `UserRole` enum and `User.role` live under `apps/server/prisma/migrations/` (e.g. `20260413140000_user_rbac`). After schema changes, run **`npx prisma migrate deploy`** (or dev migrate) and **`npx prisma generate`** from `apps/server`. On Windows + OneDrive, `prisma generate` can hit file-lock errors; retry or run outside synced folders if needed.

---

## RBAC (roles & access)

| Role | Label (UI) | Capabilities (summary) |
|------|------------|-------------------------|
| **`ORG_ADMIN`** | Organization Admin | Full **Admin** (settings, ingest, lenses, OIDC, …), **User admin** (`/admin/users`), **API keys** (`/admin/credentials`), **Tags**, **API debug** (including clear outbound traces), **Locations** & **Circuits** CRUD |
| **`LOCATION_CIRCUIT`** | Location & Circuit | **Locations** & **Circuits** CRUD (including speed presets), **Tags** CRUD, **API debug** read (presets exclude admin/credentials/integration-test paths; **no** clear trace buffer; custom request **GET only**), **no** Admin settings, **no** User admin, **no** API keys nav |
| **`USER`** | User (read-only) | **Dashboard** (`/`), **Locations**, **Circuits**, **Reporting** — **read-only** UI; **no** Admin, Tags, API keys, or API debug; server returns **403** on forbidden mutations |

**Server** (`apps/server/src/lib/rbac.ts`): `requireRoles`, `requireOrgAdmin`, `requireSiteEditor` (org admin + location/circuit), `requireTagEditor` (same as site editor for tags), `requireDebugReader` (org admin + location/circuit for outbound trace **GET**). Applied via Fastify **`preHandler`** on routes in `admin.ts`, `credentials.ts`, `users.ts`, `sites.ts` (mutations / discover / import), `circuits.ts` (mutations / speed preset writes), `tags.ts`, `debugOutbound.ts` (clear = org admin only), `tls.ts`, etc.

**First user / SSO:** Bootstrap/first user creation assigns **`ORG_ADMIN`**. New OIDC-provisioned users default to **`USER`** unless changed by an org admin.

**API — user management** (org admin only): `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/:id` — see `apps/server/src/routes/users.ts`.

**API — session identity:** `GET /api/auth/me` returns `{ id, email, role }`.

**API — dashboard for all roles:** `GET /api/dashboard/ui-config` — **`requireAuth` only**; returns **`lenses`**, **`googleMapsEnabled`**, **`openWeatherKeyConfigured`** (boolean). The main dashboard **must not** call `GET /api/admin/settings` for initial load (that route is org-admin only). `GET /api/dashboard/sites` and other dashboard read endpoints remain **`requireAuth`** where not otherwise restricted.

---

## Features (behavioral)

1. **Dashboard (`/`)** — Google Map (when enabled + key), grid of **`LocationCardSummary`** cards, **`SiteDetailPanel`** when a pin is selected; lenses from **`/api/dashboard/ui-config`**. **Visible to all authenticated roles.** Help text for empty snapshots distinguishes org admins (points to Admin / API keys) vs read-only users (points to “ask an organization admin”).
2. **Locations (`/sites`)** — List/detail for all roles; **CRUD / discover / import** for `ORG_ADMIN` and `LOCATION_CIRCUIT`; read-only banner and disabled controls for **`USER`**.
3. **Circuits (`/circuits`)** — Table + speed library list for all roles; **add/edit/delete** circuits and preset management for editors only; read-only for **`USER`**.
4. **Reporting (`/reporting`)** — Available to authenticated users (aligns with read-only reporting for **`USER`**).
5. **Admin (`/admin`)** — **`ORG_ADMIN`** only (settings, ingest, lenses, …). **User admin** link on the page and sidebar entry: **`/admin/users`**.
6. **User admin (`/admin/users`)** — **`ORG_ADMIN`** only — list/create/update/delete users and roles.
7. **Credentials (`/admin/credentials`)** — **`ORG_ADMIN`** only.
8. **Tags (`/tags`)** — **`ORG_ADMIN`** and **`LOCATION_CIRCUIT`** only (route + server).
9. **API debug (`/debug`)** — **`ORG_ADMIN`** and **`LOCATION_CIRCUIT`**; clear outbound buffer and full preset/custom-POST behavior per **`rbac.ts`** / `roles.ts` above.

**Coordinate resolution** — `resolveSiteCoordinates` / `merakiGeoFromSnapshotPayload`: if `locationLatLngManual`, use DB `lat`/`lng`; else prefer Meraki geo from latest snapshot; else DB.

**ThousandEyes enterprise test metrics** (uplink sidecar): `GET /api/dashboard/sites/:siteId/thousandeyes-enterprise-test-metrics` calls TE test-results **live**, with **in-memory TTL cache** (`teEnterpriseTestMetricsCache.ts`) and **pagination caps** (`teEnterpriseTestMetrics.ts`). Env: `TE_ENTERPRISE_METRICS_CACHE_TTL_MS`, `TE_TEST_RESULTS_MAX_PAGES`, etc.

---

## Scaling / future work (planned)

- Today **`GET /api/dashboard/sites`** returns **all** sites with embedded snapshot payloads — fine for tens of sites; for **hundreds**, plan a **compact list + map**, **paginated or virtualized** list API, **`?site=`** deep-link, and **detail-on-demand** loads (see planning discussions; not all implemented).

---

## Conventions for contributors

- **No secrets in code** — use env + `CredentialVault` / `env.example`
- Match existing patterns in each app (imports, component style)
- Run `npx tsc --noEmit` in `apps/server` and `npm run build` in `apps/web` after substantive changes
- **RBAC:** Add or change an API — update **`rbac.ts`** preHandlers and **`apps/web/src/lib/roles.ts`** + any **`RoleRoute`** / sidebar / page guards together so the UI and API stay aligned

---

## Summary prompt (copy for AI / LLM context)

```
You are working on the Retail Operations Dashboard monorepo (npm workspaces: apps/server Fastify+Prisma, apps/web React+Vite).

Purpose: retail store operations UI integrating Meraki (WAN, devices, alerts, uplink history) and ThousandEyes (enterprise agents/tests in snapshots; live TE test metrics for optional uplink latency/loss charts), plus carrier circuits, OpenWeather, encrypted credentials.

RBAC: User.role is ORG_ADMIN | LOCATION_CIRCUIT | USER. Server: apps/server/src/lib/rbac.ts + preHandlers on routes. Web: apps/web/src/lib/roles.ts, App.tsx RoleRoute, Layout.tsx nav. Org admin: full admin, /admin/users, /admin/credentials, tags, API debug (incl. clear traces). Location & circuit: sites/circuits/tags CRUD, API debug read-only (no clear; filtered presets; custom GET only). User: read-only dashboard/locations/circuits/reporting; no admin, tags, API keys, API debug.

Key files: apps/server/prisma/schema.prisma; apps/server/src/routes/dashboard.ts (includes GET /api/dashboard/ui-config for lens/map flags — any auth user); apps/server/src/routes/users.ts; apps/server/src/jobs/*Ingest.ts; apps/web/src/pages/DashboardPage.tsx (must use /api/dashboard/ui-config, not /api/admin/settings, for shared load); apps/web/src/lib/roles.ts; apps/web/src/App.tsx.

Site locations: Site model; snapshots in MetricSnapshot (meraki/thousandeyes JSON). Manual map coords: locationLatLngManual.

When changing TE-heavy paths, respect teEnterpriseTestMetricsCache and pagination env vars to avoid API 429s.

Follow README.md and docs/CONFIGURATION.md for secrets and deployment. Do not commit credentials.
```

---

*Last updated: RBAC user management, dashboard `ui-config`, route guards, and read-only UI behavior documented above. Align with `README.md` and `docs/` if they diverge.*
