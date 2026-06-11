# Changelog

## 1.3.0 — 2026-06-11

Endpoint inventory enrichment release. Surfaces root-level
**ThousandEyes Endpoint Agent** fields that the Endpoint Agents API
v7.0.91 contract exposes but that the dashboard was previously
discarding: serial number, NIC model, NIC driver version, battery
level / health, free disk %, TE agent license type and version-drift
annotation, plus Windows NPCAP driver version. Corrects the Wi-Fi
correlation block to drop the always-null SNR and channel-width cells
(not contracted by TE) and adds **PHY mode** (802.11ac / ax / etc.)
which IS contracted.

### Features

- **Endpoint Agent sidecar — Machine grid** gains rows for:
  - Serial number (`EndpointAgent.serialNumber`)
  - NIC model (`EndpointAgent.nicModel`)
  - NIC driver version (`EndpointAgent.nicDriverVersion`)
  - Battery level + battery health (`EndpointAgent.batteryMetrics`)
  - Free disk percentage (`EndpointAgent.freeDiskSpaceNormalized`)
  - License type (`EndpointAgent.licenseType`)
  - NPCAP driver version (Windows-only `EndpointAgent.npcapVersion`)
  - TE agent version with `(target X.Y.Z)` annotation when the spec
    returns both the current and TE-recommended target version
  - Each row reads from the live per-agent fetch first, then falls
    back to the snapshot-captured inventory when the live call is
    rate-limited or unavailable.
- **Endpoint Agents table** (`apps/web/src/components/SiteSummaryTables.tsx`):
  - Hover-tooltip on the hostname shows serial, hardware (manufacturer
    + model), OS version, NIC, and TE agent version sourced from the
    snapshot blob.
  - A monospace `SN <serial>` subtitle renders under the hostname when
    the snapshot captured one. No new column was added — tight rows
    were preserved.
- **Wi-Fi correlation block** (`apps/web/src/components/EndpointAgentSidecar.tsx`,
  `apps/server/src/lib/wirelessCorrelator.ts`):
  - **PHY mode** row added, sourced from `WirelessProfile.phyMode`
    which the TE v7.0.91 spec contracts.
  - **SNR** row removed. The TE `WirelessProfile` schema does NOT
    contract `signalToNoiseRatio` / `snr` / `signalQuality`; on
    spec-compliant agents the cell was always null. Defensive reads
    are retained on the server in case undocumented builds emit it,
    but no UI cell is wasted.
  - The channel-width tag (e.g. `(80 MHz)`) is kept in the channel
    cell where TE happens to return it but is also noted as non-spec
    in the type comments.

### Schema / data shape

- `apps/server/src/jobs/thousandEyesIngest.ts` —
  `slimEndpointAgentRow()` now extracts a Tier A `inventory` blob
  alongside the existing `wireless` block. The blob is persisted into
  each TE snapshot, so future ingests round-trip cleanly without
  needing a separate live fetch per row.
- `apps/web/src/lib/sitePayloads.ts` — new
  `TEEndpointAgentInventory` type and `parseEndpointInventory()`
  parser. Optional on every row so older snapshots from pre-1.3.0
  ingests degrade to "—" rather than crashing.
- `apps/server/src/routes/dashboard.ts` — endpoint detail route
  attaches the snapshot inventory alongside `wirelessCorrelation` and
  `merakiClientEvents` so the sidecar can render even when the live
  per-agent fetch fails (e.g. TE 429).
- `EndpointWirelessSnapshot` and `WirelessEndpointCorrelation` gain a
  `phyMode: string | null` field that propagates through the
  correlator and into the persisted snapshot.

### Audit note (TE Endpoint Agents API v7.0.91)

- The TE `WirelessProfile` schema contract is `bssid`, `ssid`, `rssi`,
  `channel`, `phyMode` — **no client MAC, no SNR, no channel width**.
  This is why the BSSID-based correlation fallback shipped in 1.2.0 is
  the right path; the v1.3.0 sidecar copy now reflects that reality.
- `serialNumber`, `nicModel`, `nicDriverVersion`, and `batteryMetrics`
  are all on the root `EndpointAgent` object — they are returned by
  the existing listing call without requiring any new `expand` value
  or extra permissions.

### Documentation

- Refreshed [README.md](README.md), [docs/USER_GUIDE.md](docs/USER_GUIDE.md),
  and this changelog. `docs/CONFIGURATION.md` did not need changes
  (no new env vars or lenses).

---

## 1.2.0 — 2026-06-10

DHCP / wireless observability release. Adds interactive sidecars for DHCP and
wireless health, per-AP connection-log slide-outs, an admin-managed model →
client-capacity matrix, and a TE Endpoint Agent ↔ Meraki MR correlation that
matches endpoints to their AP via client MAC or BSSID and flags poor RSSI
and association / DHCP failures as **impacted on Wi-Fi**.

### Features

- **DHCP Health sidecar** (`apps/web/src/components/DhcpHealthSidecar.tsx`,
  `apps/server/src/lib/dhcpScopeHealthCache.ts`,
  `apps/server/src/routes/dashboard.ts`): per-scope gauges (utilization, lease
  duration), plus DNS servers and domain name handed out. Sliding panel on the
  site card "DHCP" pill.
- **Wireless Health sidecar** (`apps/web/src/components/WirelessHealthSidecar.tsx`,
  `apps/server/src/lib/wirelessHealthCache.ts`): per-AP semi-gauges for
  client count vs configured capacity, average RSSI (Tx/Rx), channel,
  power level, channel-utilization (2.4 / 5 / 6 GHz, with fallback for
  RF-profile-managed APs that report nulls on `radio/settings`), airtime
  and noise. Per-SSID load shares use a hybrid loading strategy
  (`apps/server/src/lib/wirelessSsidLoadCache.ts`): a bulk load for
  small sites, lazy per-row loading for sites above
  `WIRELESS_SSID_LOAD_BULK_THRESHOLD`.
- **Wireless Connection Log sidecar**
  (`apps/web/src/components/WirelessConnectionLogSidecar.tsx`,
  `apps/server/src/lib/wirelessConnectionLogCache.ts`): per-MR association /
  auth / DHCP event log accessed via the **View log** button under the
  Live column. Default window configurable through the
  `wirelessConnLogDefaultWindow` lens (1 h, 12 h, 24 h, 7 d).
- **Admin Wireless Capacity page**
  (`apps/web/src/pages/AdminWirelessCapacityPage.tsx`,
  `apps/server/src/routes/adminWirelessCapacity.ts`): organization admins
  can add, edit, or delete model → max-clients rows in
  `MerakiModelClientCapacity` (new Prisma model + migration). Cross-site
  RBAC checks ensure non-org-admins cannot mutate or read non-public rows.
- **TE Endpoint Agent ↔ Meraki MR Wi-Fi correlation**
  (`apps/server/src/lib/wirelessCorrelator.ts`,
  `apps/server/src/jobs/thousandEyesIngest.ts`,
  `apps/web/src/components/EndpointAgentSidecar.tsx`,
  `apps/web/src/components/SiteSummaryTables.tsx`):
  - TE Endpoint Agents are matched to a Meraki MR first by client MAC
    (`/networks/{id}/clients`) and, when that fails, by **BSSID** using the
    org-wide `/organizations/{id}/wireless/ssids/statuses/byDevice` listing.
    The BSSID fallback is what lets Android / iOS / managed-MAC fleets
    correlate even when TE never exposes the client MAC.
  - Each endpoint snapshot carries a pre-computed `tone`
    (green / amber / red / neutral) driven by RSSI thresholds plus recent
    association / auth / DHCP failures on the matched MR.
  - Endpoint table gains a **Wi-Fi** column with a colored pill
    (`<SSID> · <MR name> · <RSSI dBm>`) and an "Open AP log →" shortcut
    that opens the matched MR's connection log pre-scoped to the right
    serial.
  - Endpoint sidecar grows a **Wi-Fi correlation (Meraki MR)** section
    with connection details, an "Access point" row, a "via BSSID" badge
    when the BSSID fallback fired, and a recent-event timeline.
- **Wireless correlation debug endpoint**: `GET /api/dashboard/sites/:siteId/
  endpoint-agents/:agentId/wireless-debug` (Organization Admin only)
  dumps the raw TE agent payload, the snapshot extracted by the
  correlator, the persisted slim row, and the persisted correlation so
  operators can pinpoint why a specific endpoint is not matching.

### Admin lenses

- `wirelessConnLogDefaultWindow` (`1h` / `12h` / `24h` / `7d`) — default
  window for the Wireless Connection Log sidecar.
- `wirelessImpactRssiAmberDbm` / `wirelessImpactRssiRedDbm` — RSSI
  thresholds that drive the Wi-Fi correlation tone. Numeric, clamped on
  the server (`apps/server/src/routes/admin.ts`).

### Configuration — new environment variables

- `WIRELESS_HEALTH_CACHE_TTL_MS` — TTL for the wireless health cache
  (default 60 s).
- `WIRELESS_SSID_LOAD_CACHE_TTL_MS` — TTL for the per-SSID load-share cache.
- `WIRELESS_SSID_LOAD_BULK_THRESHOLD` — site size above which the SSID
  load sidecar falls back to lazy per-row loading instead of a single
  bulk fetch (defends Meraki rate limits on large sites).
- `WIRELESS_CONN_LOG_CACHE_TTL_MS` — TTL for the connection-log cache.

### Database

- New `MerakiModelClientCapacity` model + migration (admin-managed AP
  client capacity).

### Security & hardening

- Cross-pillar request authorization enforced on all new admin endpoints
  (`Admin Wireless Capacity` writes, wireless-debug endpoint, Wi-Fi
  correlation routes) via the existing `requireOrgAdmin` pre-handler.
- All new caches are in-process and short-TTL; serial → site bindings
  validated on every request so a user with one site cannot read another
  site's wireless / DHCP / log data via crafted query parameters.
- New scheduled / on-demand outbound calls are routed through
  `tracedFetch`; they appear in the API debug trace buffer with the
  expected provider tag.

### Build

- **TS2307 on `import "./index.css"`** fixed by adding the standard Vite
  ambient-types reference at `apps/web/src/vite-env.d.ts`
  (`/// <reference types="vite/client" />`). This declares the side-effect
  CSS / SVG / `?url` / `?raw` / `?worker` import modules and
  `import.meta.env` types — required because `tsconfig.json` enables
  `noUncheckedSideEffectImports`.

### Documentation

- Refreshed [README.md](README.md), [docs/USER_GUIDE.md](docs/USER_GUIDE.md),
  and [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the new sidecars,
  admin pages, lenses, and env vars.

---

## 1.1.0 — 2026-04-17

A full security hardening pass across critical, high, and medium tiers, plus the bulk
circuit import feature and related documentation refresh.

### Security — critical tier

- **CORS locked down**: replaced `origin: true` with an explicit allow-list derived from
  `PUBLIC_URL`, `FRONTEND_URL`, and new `ALLOWED_ORIGINS`. Rejects unlisted origins.
- **CSRF defense** (`apps/server/src/lib/originGuard.ts`): global `preHandler` validates
  `Origin` / `Referer` on every mutating request (POST / PUT / PATCH / DELETE) against
  the allow-list. OIDC callback exempted. Returns 403 otherwise.
- **Session fixation fixed**: `req.session.regenerate()` before assigning `session.userId`
  in `/api/auth/login`, `/api/auth/oidc/callback`, and `/api/setup`.
- **Persistent session store**: replaced in-memory default with a Prisma-backed store
  (`apps/server/src/lib/sessionStore.ts`, new `Session` model + migration). Sessions now
  survive restarts and can be scaled horizontally.
- **Login rate limiting**: `@fastify/rate-limit` 10/min per IP on `/api/auth/login`, 5/min
  on `/api/setup`, plus per-account 5-in-15 throttle
  (`apps/server/src/lib/loginThrottle.ts`) that resists distributed credential stuffing.
- **CSV formula-injection escape**: `apps/server/src/lib/circuitBulkImport.ts`
  `escapeCsvCell` now prefixes cells starting with `= + - @ \t \r` with `'`.
- **TLS upload validation** (`apps/server/src/lib/tlsValidation.ts` +
  `apps/server/src/routes/tls.ts`): fieldname allow-list; X.509 parse;
  not-expired / not-far-future; RSA ≥2048 / EC ≥P-256; no MD5 / SHA-1 signatures;
  cert public key matches provided private key.
- **Password policy** (`apps/server/src/lib/passwordPolicy.ts`): 12-character minimum,
  common-password block-list. Applied on setup, admin user creation / password update,
  and bootstrap.
- **Race condition in `/api/setup` fixed**: Postgres advisory lock inside a transaction
  prevents two concurrent setup requests from each creating an admin.

### Security — high tier

- **`TRUST_PROXY` env**: Fastify-level `trustProxy` flag so reverse-proxy deployments get
  accurate `req.ip` (rate limiting) and `req.protocol` (secure-cookie detection). Also
  powers `X-Forwarded-*` handling.
- **OIDC SSRF defense** (`apps/server/src/lib/urlGuard.ts` + validation in
  `routes/oidc.ts` and `routes/admin.ts`): `OIDC_ISSUER_URL` is validated as HTTPS, not
  private / reserved / link-local, not a block-listed hostname, and (optionally) must
  match `OIDC_ISSUER_ALLOWLIST`. Checks run both at login and at admin-save time.

### Security — medium tier

- **F-11** `CREDENTIALS_MASTER_KEY` hardened: minimum length 32 (was effectively 1), Zod
  error message includes a cross-platform generation command. New `CREDENTIALS_SALT`
  env for per-install scrypt salt (`apps/server/src/lib/cryptoVault.ts`); legacy fallback
  salt retained for backward compatibility with a one-time boot warning.
- **F-12** Bootstrap admin: role now explicitly `ORG_ADMIN`, password is validated
  against the password policy (process exits on weak value), and a single-shot warning
  fires after successful bootstrap instructing the operator to unset
  `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD`. A recurring boot warning fires
  if users already exist while the env vars are still set.
- **F-13** Error handler: 5xx responses now return a generic
  `"Internal server error"` body with a `requestId` for log correlation. `error.message`
  and stack traces are suppressed in production and included as `devMessage` only when
  `NODE_ENV=development`.
- **F-14** OIDC SSRF allow-list: new optional `OIDC_ISSUER_ALLOWLIST` env (see above).
- **F-15** Last-ORG_ADMIN guard: `DELETE /api/admin/users/:id` and role-changing
  `PATCH /api/admin/users/:id` refuse operations that would leave the system with zero
  `ORG_ADMIN` users.
- **F-16** `__Host-` cookie prefix: in `production` + HTTPS, session cookie name is
  `__Host-rsid` (Secure, Path=/, no Domain). Dev / non-HTTPS fall back to `rsid`.

### Features

- **Bulk circuit import** (`apps/web/src/components/CircuitBulkImport.tsx`,
  `apps/server/src/lib/circuitBulkImport.ts`, `apps/server/src/routes/circuits.ts`):
  paste or upload CSV on the Circuits page, preview new vs. updated rows, import with
  idempotency (new `CircuitImport` table, migration
  `20260415180000_circuit_import_idempotency`). Available to ORG_ADMIN and
  LOCATION_CIRCUIT.
- **CSV parsing helper** (`apps/web/src/lib/csvParse.ts`): shared client-side parsing
  for the import UI.

### Configuration

- **New environment variables**:
  - `CREDENTIALS_SALT` (recommended)
  - `ALLOWED_ORIGINS` (optional, comma-separated)
  - `TRUST_PROXY` (required when behind a proxy)
  - `OIDC_ISSUER_ALLOWLIST` (optional, defense-in-depth)
- **Changed requirements**: `CREDENTIALS_MASTER_KEY` now enforces a 32-character minimum;
  `ADMIN_BOOTSTRAP_PASSWORD` must satisfy the password policy.
- **Refreshed** `env.example` with stronger placeholders and inline guidance.

### Database

- New `Session` model (migration `20260417120000_add_session_store`).
- New `CircuitImport` model (migration `20260415180000_circuit_import_idempotency`).

### Documentation

- New [docs/SECURITY.md](docs/SECURITY.md) — full threat model and control inventory.
- New [docs/RUNBOOK_CREDENTIAL_ROTATION.md](docs/RUNBOOK_CREDENTIAL_ROTATION.md) — cold
  rotation and re-encrypt migration paths for `CREDENTIALS_MASTER_KEY` /
  `CREDENTIALS_SALT`.
- Refreshed [README.md](README.md), [docs/CONFIGURATION.md](docs/CONFIGURATION.md),
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), and [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
  to reflect 1.1.0 behavior (password policy, throttling, proxy setup, session store,
  TLS validation, bulk import).
- Removed planning scratch docs (`PLAN_CIRCUIT_BULK_IMPORT.md`,
  `PLAN_BULK_SITES_AND_CIRCUITS.md`) now that the features they described have shipped.

### Versioning

- Root, `apps/server`, and `apps/web` `package.json` versions bumped to `1.1.0` to reflect
  this minor release over the 1.0 baseline established by pre-1.1.0 dev iterations.

---

## 1.0.0 — 2026-04-13 (baseline)

Baseline release consolidating the pre-1.1.0 development iterations
(0.1.0 through 0.3.0). Retained below for historical context.

### RBAC & user management

- **`UserRole`** (`ORG_ADMIN`, `LOCATION_CIRCUIT`, `USER`) on **`User`** — Prisma enum +
  migration; existing users may be migrated to org admin; new users default to **`USER`**
  unless otherwise set.
- **`apps/server/src/lib/rbac.ts`** — `requireOrgAdmin`, `requireSiteEditor`,
  `requireTagEditor`, `requireDebugReader`, etc.; applied to admin, credentials, user
  CRUD, site/circuit mutations, tags, outbound debug clear, TLS upload, and related
  routes.
- **`/api/admin/users`** — list, create, update (role/email/password), delete (org admin
  only); **`GET /api/auth/me`** includes **`role`**. Bootstrap / first user is org admin;
  OIDC-provisioned users default to **`USER`**.
- **`apps/web`** — `lib/roles.ts` helpers; **`RoleRoute`** for `/admin`, `/admin/users`,
  `/admin/credentials`, `/debug`, `/tags`; sidebar hides Admin, Tags, API keys, and API
  debug per role; **`AdminUsersPage`** for user administration.

### Dashboard (all roles)

- **`GET /api/dashboard/ui-config`** — authenticated read of lens/map flags (`lenses`,
  `googleMapsEnabled`, **`openWeatherKeyConfigured`**) so the main dashboard does not call
  **`/api/admin/settings`** (org-admin only). Read-only users can load the location
  overview without 403.
- **`DashboardPage`** — uses **`ui-config`**; help copy for empty snapshots and card
  columns distinguishes org admins vs read-only users.

### Read-only UI

- **Locations** (`SitesPage`) and **Circuits** (`CircuitsPage`) — banners and
  disabled/hidden create-edit flows for **`USER`**; editors unchanged.
- **API debug** (`ApiDebugPage`) — preset list and custom method restricted for
  non–org-admins; **Clear trace buffer** org-admin only (matches server).

### Locations & coordinates

- **`Site.locationLatLngManual`** — optional manual latitude/longitude on the Locations
  page; when enabled, stored coordinates are authoritative for map pins and OpenWeather
  (Meraki geo from ingest is shown read-only for comparison).
- **`resolveSiteCoordinates`** / **`merakiGeoFromSnapshotPayload`** — central logic for
  dashboard map, weather, ThousandEyes ingest geo matching, and related routes.

### Dashboard — uplink history (Meraki + ThousandEyes)

- **Historical uplink sidecar** — Meraki uplink traffic, latency, and loss (usage + loss /
  latency history APIs).
- **Latency & loss source** — default **Meraki** (WAN connectivity test target IP);
  optional **ThousandEyes enterprise tests** (HTTP + agent-to-server tests from the site
  TE snapshot) via dropdown; charts switch source; traffic stays Meraki-only.
- **`GET /api/dashboard/sites/:siteId/thousandeyes-enterprise-test-metrics`** — live TE
  v7 test-results (`network`, `http-server`, `page-load`, `api` by test type), with
  result pagination and per-round aggregation across agents.
- **Rate limiting / API use** — short **in-memory TTL cache** for enterprise test metrics
  (`teEnterpriseTestMetricsCache.ts`); lower **pagination and row caps** on TE fetches
  (`TE_TEST_RESULTS_MAX_PAGES`, `TE_TEST_RESULTS_MAX_ROWS`, cache TTL/max entries via
  env). Response header `X-TE-Enterprise-Metrics-Cache: HIT|MISS`.

### Foundation

- Initial monorepo: Fastify API + Prisma + Postgres, React (Vite) UI.
- Meraki and ThousandEyes ingest with configurable poll intervals; encrypted credential
  vault.
- Admin lenses, store CRUD, optional Google Maps, TLS PEM upload, OIDC (PKCE) login path.
- Session heartbeat endpoint and retention purge job.

### Documentation

- `prompt.md` — project overview, stack, key paths, and a copy-paste LLM summary prompt.
- `docs/CONFIGURATION.md`, `docs/DEPLOYMENT.md`, `docs/USER_GUIDE.md` — initial release
  documentation.
