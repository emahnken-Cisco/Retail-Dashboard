# Retail Dashboard — project context & AI prompt

Use this file to onboard tools or people quickly. For setup and deployment, see `README.md` and `docs/`. Current release: **v1.1.0** (security hardening + circuit bulk import).

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
| API | **Fastify** (TypeScript), **Zod** validation, **Prisma-backed sessions**, CSRF origin guard, per-IP + per-account login throttle |
| DB | **PostgreSQL**, **Prisma** (`apps/server/prisma/schema.prisma`) |
| Web | **React** + **Vite**, **React Router** |
| Crypto | API secrets encrypted at rest (AES-256-GCM) in `CredentialVault`; scrypt KDF with per-install `CREDENTIALS_SALT`; `CREDENTIALS_MASTER_KEY` min 32 chars |
| Session cookie | `__Host-rsid` in production (HTTPS), `rsid` in dev; `HttpOnly` + `SameSite=Lax` + `Secure` in prod |

**Monorepo:** npm workspaces — `apps/server`, `apps/web`. Root scripts: `npm run dev`, `npm run build`, `npm run db:migrate`.

---

## Repository layout (high level)

```
apps/server/          # Fastify API, Prisma, jobs (meraki ingest, TE ingest, circuit outage recorder)
apps/web/             # React SPA
docs/                 # DEPLOYMENT, CONFIGURATION, USER_GUIDE, SECURITY, RUNBOOK_CREDENTIAL_ROTATION
env.example           # Template for root .env (never commit real secrets)
```

**Important server areas**

- `src/routes/` — dashboard, sites, circuits (incl. **bulk import** endpoints), admin, credentials, auth, tags, **users** (admin user CRUD), tls, oidc, setup, debugOutbound
- `src/jobs/` — Meraki ingest, ThousandEyes ingest, scheduler (cron), retention
- `src/lib/` —
  - Integrations: Meraki client, ThousandEyes client, site coordinates, TE enterprise test metrics + cache, OpenWeather quota
  - RBAC: **`rbac.ts`** (role preHandlers)
  - **Security (v1.1.0)**:
    - **`originGuard.ts`** — CSRF origin/referer check on mutating requests (allow-list from `PUBLIC_URL` / `FRONTEND_URL` / `ALLOWED_ORIGINS`; OIDC callback exempt)
    - **`sessionStore.ts`** — Prisma-backed persistent session store (new `Session` model)
    - **`loginThrottle.ts`** — per-account 5-in-15 login throttle layered on top of `@fastify/rate-limit` (10/min per IP on `/api/auth/login`, 5/min on `/api/setup`)
    - **`passwordPolicy.ts`** — 12-char min + common-password block-list (setup, admin user CRUD, `ADMIN_BOOTSTRAP_PASSWORD`)
    - **`tlsValidation.ts`** — PEM parse, key-pair match, expiry, RSA ≥2048 / EC ≥P-256, reject MD5/SHA-1 signatures; fieldname allow-list on multipart uploads
    - **`urlGuard.ts`** — SSRF guard for OIDC issuer discovery / admin-entered URLs (HTTPS only, no private/reserved/link-local, optional `OIDC_ISSUER_ALLOWLIST` pinning)
    - **`cryptoVault.ts`** — AES-256-GCM vault; scrypt KDF with `CREDENTIALS_SALT` + legacy-salt fallback (one-time warning)
    - **`circuitBulkImport.ts`** — idempotent CSV import (new `CircuitImport` ledger); CSV export escapes formula-injection prefixes (`= + - @ \t \r`)

**Important web areas**

- `src/lib/roles.ts` — role types and **`canEditStores`**, **`canViewTags`**, **`canViewAdminSettings`**, **`canViewApiDebug`**, **`canClearOutboundTraces`**, etc.
- `src/auth.tsx` — session user includes **`role`**
- `src/App.tsx` — **`Private`** (any authenticated user) vs **`RoleRoute`** (allow-listed roles)
- `src/Layout.tsx` — sidebar links gated by role (Admin block, Tags, API debug, credentials)
- `src/pages/DashboardPage.tsx` — map, location grid, `SiteDetailPanel`; uses **`/api/dashboard/ui-config`** (not admin settings) so all roles can load
- `src/pages/AdminUsersPage.tsx` — org-admin user management (create/update/delete users, assign roles)
- `src/components/SiteSummaryTables.tsx` — `SiteDetailPanel`, `LocationCardSummary`, WAN/TE tables
- `src/components/UplinkHistorySidecar.tsx` — Meraki uplink traffic + latency/loss; TE enterprise test option for latency/loss
- `src/components/CircuitBulkImport.tsx` — **bulk circuit CSV import modal** (preview diff → idempotent import)
- `src/lib/sitePayloads.ts` — parsing Meraki/TE snapshot JSON for the UI
- `src/lib/csvParse.ts` — shared client-side CSV parsing for bulk import

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
- **`Session`** *(new in v1.1.0)* — Prisma-backed session records used by `sessionStore.ts`; replaces the in-memory default so sessions survive restarts and scale horizontally
- **`CircuitImport`** *(new in v1.1.0)* — idempotency ledger for the bulk CSV importer (migration `20260415180000_circuit_import_idempotency`)

**Migrations:** `UserRole` enum and `User.role` live under `apps/server/prisma/migrations/` (e.g. `20260413140000_user_rbac`). v1.1.0 adds `20260415180000_circuit_import_idempotency` (`CircuitImport`) and `20260417120000_add_session_store` (`Session`). After schema changes, run **`npx prisma migrate deploy`** (or dev migrate) and **`npx prisma generate`** from `apps/server`. On Windows + OneDrive, `prisma generate` can hit file-lock errors; retry or run outside synced folders if needed.

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
3. **Circuits (`/circuits`)** — Table + speed library list for all roles; **add/edit/delete** circuits and preset management for editors only; read-only for **`USER`**. **Bulk CSV import** (ORG_ADMIN + LOCATION_CIRCUIT): preview new vs. updated rows before commit; idempotent via `CircuitImport` ledger; CSV exports escape formula-injection cells (`= + - @ \t \r`).
4. **Reporting (`/reporting`)** — Available to authenticated users (aligns with read-only reporting for **`USER`**).
5. **Admin (`/admin`)** — **`ORG_ADMIN`** only (settings, ingest, lenses, …). **User admin** link on the page and sidebar entry: **`/admin/users`**.
6. **User admin (`/admin/users`)** — **`ORG_ADMIN`** only — list/create/update/delete users and roles.
7. **Credentials (`/admin/credentials`)** — **`ORG_ADMIN`** only.
8. **Tags (`/tags`)** — **`ORG_ADMIN`** and **`LOCATION_CIRCUIT`** only (route + server).
9. **API debug (`/debug`)** — **`ORG_ADMIN`** and **`LOCATION_CIRCUIT`**; clear outbound buffer and full preset/custom-POST behavior per **`rbac.ts`** / `roles.ts` above.

**Coordinate resolution** — `resolveSiteCoordinates` / `merakiGeoFromSnapshotPayload`: if `locationLatLngManual`, use DB `lat`/`lng`; else prefer Meraki geo from latest snapshot; else DB.

**ThousandEyes enterprise test metrics** (uplink sidecar): `GET /api/dashboard/sites/:siteId/thousandeyes-enterprise-test-metrics` calls TE test-results **live**, with **in-memory TTL cache** (`teEnterpriseTestMetricsCache.ts`) and **pagination caps** (`teEnterpriseTestMetrics.ts`). Env: `TE_ENTERPRISE_METRICS_CACHE_TTL_MS`, `TE_TEST_RESULTS_MAX_PAGES`, etc.

---

## Security hardening (v1.1.0)

See [`docs/SECURITY.md`](docs/SECURITY.md) for the full threat model. Highlights:

- **CORS allow-list** — explicit list derived from `PUBLIC_URL`, `FRONTEND_URL`, `ALLOWED_ORIGINS`; `origin: true` is no longer used.
- **CSRF origin guard** — global `preHandler` validates `Origin`/`Referer` on all mutating methods; OIDC callback exempt.
- **Session fixation** — `req.session.regenerate()` before setting `session.userId` in login, OIDC callback, and setup.
- **Persistent sessions** — Prisma-backed `Session` store (`sessionStore.ts`); survives restarts.
- **`__Host-rsid` cookie** — in production + HTTPS (no Domain, Path=/, Secure, HttpOnly, SameSite=Lax); falls back to `rsid` in dev.
- **Login abuse controls** — `@fastify/rate-limit` (10/min per IP on `/api/auth/login`, 5/min on `/api/setup`) + per-account 5-in-15 throttle (`loginThrottle.ts`).
- **Password policy** — 12-char minimum + common-password block-list; applied on setup, admin user CRUD, and `ADMIN_BOOTSTRAP_PASSWORD` (process exits on weak bootstrap value).
- **Setup race fixed** — PostgreSQL advisory lock inside `$transaction`; bootstrap role explicitly `ORG_ADMIN`; post-bootstrap warnings instruct unsetting `ADMIN_BOOTSTRAP_*`.
- **Last-ORG_ADMIN guard** — `DELETE /api/admin/users/:id` and role-demoting `PATCH` refuse to leave the system with zero org admins.
- **TLS upload validation** — `tlsValidation.ts` + `routes/tls.ts`: fieldname allow-list, X.509 parse, not-expired/not-far-future, RSA ≥2048 / EC ≥P-256, reject MD5/SHA-1, cert/key pair match.
- **OIDC SSRF guard** — `urlGuard.ts` validates `OIDC_ISSUER_URL` (HTTPS, non-private, non-link-local, non-block-listed); optional `OIDC_ISSUER_ALLOWLIST` pinning; enforced both at login and on admin save.
- **Credential vault** — `CREDENTIALS_MASTER_KEY` min 32 chars; new `CREDENTIALS_SALT` env for per-install scrypt salt (legacy fallback emits one-time boot warning). See [`docs/RUNBOOK_CREDENTIAL_ROTATION.md`](docs/RUNBOOK_CREDENTIAL_ROTATION.md).
- **Error hygiene** — 5xx responses return generic body + `requestId` for correlation; `error.message`/stack suppressed in prod (`devMessage` only when `NODE_ENV=development`).
- **Proxy awareness** — `TRUST_PROXY` env controls Fastify `trustProxy` so `req.ip` / `req.protocol` are correct behind a reverse proxy (drives rate limiting and secure-cookie detection).

**New/changed env vars in v1.1.0** (see `env.example` and `docs/CONFIGURATION.md`):

- New: `CREDENTIALS_SALT` (recommended), `ALLOWED_ORIGINS` (optional), `TRUST_PROXY` (required behind a proxy), `OIDC_ISSUER_ALLOWLIST` (optional defense-in-depth).
- Changed: `CREDENTIALS_MASTER_KEY` now requires ≥32 chars; `ADMIN_BOOTSTRAP_PASSWORD` must satisfy the password policy.

---

## Scaling / future work (planned)

- Today **`GET /api/dashboard/sites`** returns **all** sites with embedded snapshot payloads — fine for tens of sites; for **hundreds**, plan a **compact list + map**, **paginated or virtualized** list API, **`?site=`** deep-link, and **detail-on-demand** loads (see planning discussions; not all implemented).

---

## Conventions for contributors

- **No secrets in code** — use env + `CredentialVault` / `env.example`
- Match existing patterns in each app (imports, component style)
- Run `npx tsc --noEmit` in `apps/server` and `npm run build` in `apps/web` after substantive changes
- **RBAC:** Add or change an API — update **`rbac.ts`** preHandlers and **`apps/web/src/lib/roles.ts`** + any **`RoleRoute`** / sidebar / page guards together so the UI and API stay aligned
- **Mutating routes:** are automatically covered by the CSRF origin guard; if you add a new external callback (like OIDC), explicitly exempt it in `originGuard.ts` and document why
- **New admin-entered URLs:** run them through `urlGuard.ts` (SSRF) before any outbound fetch
- **New password fields or setup flows:** validate with `passwordPolicy.ts`; never log or return credentials
- **CSV / spreadsheet output:** always route cells through the formula-injection escape helper in `circuitBulkImport.ts`

---

## Summary prompt (copy for AI / LLM context)

```
You are working on the Retail Operations Dashboard monorepo, v1.1.0 (npm workspaces: apps/server Fastify+Prisma, apps/web React+Vite).

Purpose: retail store operations UI integrating Meraki (WAN, devices, alerts, uplink history) and ThousandEyes (enterprise agents/tests in snapshots; live TE test metrics for optional uplink latency/loss charts), plus carrier circuits, OpenWeather, encrypted credentials.

RBAC: User.role is ORG_ADMIN | LOCATION_CIRCUIT | USER. Server: apps/server/src/lib/rbac.ts + preHandlers on routes. Web: apps/web/src/lib/roles.ts, App.tsx RoleRoute, Layout.tsx nav. Org admin: full admin, /admin/users, /admin/credentials, tags, API debug (incl. clear traces). Location & circuit: sites/circuits/tags CRUD + bulk circuit CSV import, API debug read-only (no clear; filtered presets; custom GET only). User: read-only dashboard/locations/circuits/reporting; no admin, tags, API keys, API debug.

Security (v1.1.0): explicit CORS allow-list (PUBLIC_URL/FRONTEND_URL/ALLOWED_ORIGINS); CSRF origin guard on mutations (apps/server/src/lib/originGuard.ts); Prisma-backed sessions (sessionStore.ts, Session model); __Host-rsid cookie in prod; session regenerate on login/OIDC/setup; per-IP @fastify/rate-limit + per-account loginThrottle.ts; 12-char password policy (passwordPolicy.ts); TLS upload validation (tlsValidation.ts: X.509 parse, RSA≥2048 / EC≥P-256, no MD5/SHA-1, cert-key match); OIDC SSRF guard (urlGuard.ts) with optional OIDC_ISSUER_ALLOWLIST; CREDENTIALS_MASTER_KEY ≥32 chars + CREDENTIALS_SALT; advisory-lock setup race fix; last-ORG_ADMIN guard; CSV formula-injection escape; generic 5xx with requestId; TRUST_PROXY for correct req.ip/protocol behind proxies.

Key files: apps/server/prisma/schema.prisma (User, Site, Circuit, CircuitImport, Session, MetricSnapshot, CredentialVault, AdminSettings); apps/server/src/routes/dashboard.ts (GET /api/dashboard/ui-config for lens/map flags — any auth user); apps/server/src/routes/users.ts; apps/server/src/routes/circuits.ts (incl. bulk import); apps/server/src/lib/{rbac,originGuard,sessionStore,loginThrottle,passwordPolicy,tlsValidation,urlGuard,cryptoVault,circuitBulkImport}.ts; apps/server/src/jobs/*Ingest.ts; apps/web/src/pages/DashboardPage.tsx (must use /api/dashboard/ui-config, not /api/admin/settings, for shared load); apps/web/src/components/CircuitBulkImport.tsx; apps/web/src/lib/{roles,csvParse}.ts; apps/web/src/App.tsx.

Site locations: Site model; snapshots in MetricSnapshot (meraki/thousandeyes JSON). Manual map coords: locationLatLngManual.

When adding a mutating route, it is automatically covered by the CSRF origin guard; exempt it explicitly in originGuard.ts only for external callbacks (OIDC pattern). Route any admin-supplied outbound URL through urlGuard.ts; validate new passwords with passwordPolicy.ts; escape all CSV output.

When changing TE-heavy paths, respect teEnterpriseTestMetricsCache and pagination env vars to avoid API 429s.

Follow README.md, docs/CONFIGURATION.md, docs/SECURITY.md, and docs/RUNBOOK_CREDENTIAL_ROTATION.md for secrets, deployment, and key rotation. Do not commit credentials.
```

---

*Last updated for **v1.1.0**: security hardening (CSRF origin guard, persistent `Session` store, `__Host-` cookie, login throttle, 12-char password policy, TLS upload validation, OIDC SSRF guard, `CREDENTIALS_SALT`, last-ORG_ADMIN guard, CSV formula-injection escape, generic 5xx + `requestId`, `TRUST_PROXY`); bulk circuit CSV import (`CircuitImport` ledger); new docs (`docs/SECURITY.md`, `docs/RUNBOOK_CREDENTIAL_ROTATION.md`). Align with `README.md`, `CHANGELOG.md`, and `docs/` if they diverge.*
