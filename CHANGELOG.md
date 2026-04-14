# Changelog

## 0.3.0 — 2026-04-13

### RBAC & user management

- **`UserRole`** (`ORG_ADMIN`, `LOCATION_CIRCUIT`, `USER`) on **`User`** — Prisma enum + migration; existing users may be migrated to org admin; new users default to **`USER`** unless otherwise set.
- **`apps/server/src/lib/rbac.ts`** — `requireOrgAdmin`, `requireSiteEditor`, `requireTagEditor`, `requireDebugReader`, etc.; applied to admin, credentials, user CRUD, site/circuit mutations, tags, outbound debug clear, TLS upload, and related routes.
- **`/api/admin/users`** — list, create, update (role/email/password), delete (org admin only); **`GET /api/auth/me`** includes **`role`**. Bootstrap / first user is org admin; OIDC-provisioned users default to **`USER`**.
- **`apps/web`** — `lib/roles.ts` helpers; **`RoleRoute`** for `/admin`, `/admin/users`, `/admin/credentials`, `/debug`, `/tags`; sidebar hides Admin, Tags, API keys, and API debug per role; **`AdminUsersPage`** for user administration.

### Dashboard (all roles)

- **`GET /api/dashboard/ui-config`** — authenticated read of lens/map flags (`lenses`, `googleMapsEnabled`, **`openWeatherKeyConfigured`**) so the main dashboard does not call **`/api/admin/settings`** (org-admin only). Read-only users can load the location overview without 403.
- **`DashboardPage`** — uses **`ui-config`**; help copy for empty snapshots and card columns distinguishes org admins vs read-only users.

### Read-only UI

- **Locations** (`SitesPage`) and **Circuits** (`CircuitsPage`) — banners and disabled/hidden create-edit flows for **`USER`**; editors unchanged.
- **API debug** (`ApiDebugPage`) — preset list and custom method restricted for non–org-admins; **Clear trace buffer** org-admin only (matches server).

### Other

- **`AdminPage`** — link to **User admin** (`/admin/users`).
- **`prompt.md`** — RBAC, `ui-config`, key files, and LLM summary updated.

## 0.2.0 — 2026-04-03

### Locations & coordinates

- **`Site.locationLatLngManual`** — optional manual latitude/longitude on the Locations page; when enabled, stored coordinates are authoritative for map pins and OpenWeather (Meraki geo from ingest is shown read-only for comparison).
- **`resolveSiteCoordinates`** / **`merakiGeoFromSnapshotPayload`** — central logic for dashboard map, weather, ThousandEyes ingest geo matching, and related routes.

### Dashboard — uplink history (Meraki + ThousandEyes)

- **Historical uplink sidecar** — Meraki uplink traffic, latency, and loss (usage + loss/latency history APIs).
- **Latency & loss source** — default **Meraki** (WAN connectivity test target IP); optional **ThousandEyes enterprise tests** (HTTP + agent-to-server tests from the site TE snapshot) via dropdown; charts switch source; traffic stays Meraki-only.
- **`GET /api/dashboard/sites/:siteId/thousandeyes-enterprise-test-metrics`** — live TE v7 test-results (`network`, `http-server`, `page-load`, `api` by test type), with result pagination and per-round aggregation across agents.
- **Rate limiting / API use** — short **in-memory TTL cache** for enterprise test metrics (`teEnterpriseTestMetricsCache.ts`); lower **pagination and row caps** on TE fetches (`TE_TEST_RESULTS_MAX_PAGES`, `TE_TEST_RESULTS_MAX_ROWS`, cache TTL/max entries via env). Response header `X-TE-Enterprise-Metrics-Cache: HIT|MISS`.

### UI copy

- Dashboard hints when coordinates are missing now mention Meraki ingest vs manual override where relevant.

### Documentation

- **`prompt.md`** — project overview, stack, key paths, and a copy-paste LLM summary prompt.

## 0.1.0 — 2026-04-03

- Initial monorepo: Fastify API + Prisma + Postgres, React (Vite) UI.
- Meraki and ThousandEyes ingest with configurable poll intervals; encrypted credential vault.
- Admin lenses, store CRUD, optional Google Maps, TLS PEM upload, OIDC (PKCE) login path.
- Session heartbeat endpoint and retention purge job.
