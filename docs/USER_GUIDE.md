# User guide

## Startup flow

1. **Install** the app on a Linux VM (see [DEPLOYMENT.md](./DEPLOYMENT.md)) or run it
   locally for development.
2. **Configure** `.env` and run database migrations.
3. **First access**: open the web UI. If no user exists, complete **Initial setup** or use
   bootstrap credentials from `.env` (see [CONFIGURATION.md](./CONFIGURATION.md)). The
   first account is an **Organization Admin**.
4. **API keys** (**Admin → API keys**): add Meraki Dashboard API key and ThousandEyes
   OAuth bearer token. Use **Test connection** where available. Only **Organization
   Admins** see this page.
5. **Locations**: add each retail location; set **Meraki network ID** to match the network
   that contains MX/MR at that site; set **ThousandEyes tag** to a substring that appears
   in the enterprise agent name for that site. Or use **Discover from ThousandEyes +
   Meraki** on the Locations page (editors only) to pull enterprise agents, auto-match
   Meraki networks, enrich lat/lng, preview payloads, and bulk-import selected rows.
6. **Circuits**: add each WAN/LTE/Starlink circuit manually, or use **Bulk import** on
   the Circuits page (editors only) to paste a CSV (see
   [Bulk circuit import](#bulk-circuit-import) below).
7. **Admin → Lenses** (organization admins): toggle Meraki / ThousandEyes panels, map,
   and **card columns** (1–6). Enable **Google Maps** and save a Maps JavaScript API key
   on the **API keys** page if you want the map.
8. **Wait** for the scheduler (or use **Full re-sync** in Admin) to populate snapshots.

## Roles and navigation

| Role | Typical use | What you see |
|------|-------------|--------------|
| **Organization Admin** | Full control | **Admin** (Settings, User admin, API keys), **Locations**, **Circuits**, **Tags**, **Reporting**, **Dashboard**, **API debug** (full, including clear outbound traces). |
| **Location & Circuit** | Site and circuit operators | **Locations**, **Circuits**, **Tags**, **Reporting**, **Dashboard**, **API debug** (read-oriented; no Admin block, no API keys). |
| **User** | View-only / reporting | **Dashboard**, **Locations**, **Circuits**, **Reporting** only — no Admin, Tags, API keys, or API debug. |

**User admin** (**Admin → User admin**): organization admins can list users, create
accounts (email, password, role), update roles, and remove users. The server refuses the
operation that would leave zero Organization Admins, and refuses self-deletion.

**Password requirements** apply to any password set through the app (setup page, user
admin, or bootstrap env):

- Minimum **12 characters**.
- Cannot be a value on the built-in common-password list.
- Length beats composition — a passphrase like `red tractor coffee window` is fine; no
  required punctuation / casing rules.

**Login throttling**: too many failed logins against the same account within 15 minutes
will lock *that account* out for 15 minutes, regardless of source IP. If you've locked
yourself out, wait 15 minutes or have an Organization Admin reset the password.

## Dashboard

- Available to **all signed-in roles**. It shows ingested data only; it does not require
  Admin settings to load (the app uses a dedicated read endpoint for lens/map options).
- **Location cards** show the latest Meraki and ThousandEyes payloads per site (when
  enabled in lenses).
- **Map** plots sites that have latitude/longitude (manual on the Locations page and/or
  Meraki geo from snapshots).
- **Refresh** reloads data from the API (not a new Meraki/TE poll). Auto-refresh can
  update site list data while the tab is visible.

### DHCP Health sidecar

Click the **DHCP** pill on a location card to open a slide-out with one tile per
DHCP scope. Each scope shows a utilization semi-gauge, lease duration, DNS
servers, and the domain name handed out. Cached briefly server-side to avoid
hammering Meraki on repeated opens.

### Wireless Health sidecar

Click the **Wi-Fi** pill on a location card to open per-AP semi-gauges:

- **Clients vs configured capacity** (capacity comes from the admin **Wireless
  Capacity** model matrix below; falls back to a sensible default per model
  when not set).
- **Average RSSI** (Tx/Rx), **channel**, **power level**.
- **Channel utilization** for 2.4 / 5 / 6 GHz (uses RF-profile-managed fallbacks
  when `radio/settings` returns nulls).
- **Airtime / noise** percentages.
- **Per-SSID load share**: for small sites the panel pre-loads every SSID; on
  larger sites (above `WIRELESS_SSID_LOAD_BULK_THRESHOLD`) the panel shows a
  **Load** button per row so you can spread Meraki calls over time. Results
  are cached server-side for the lens-configured TTL.

### Wireless Connection Log sidecar

On the dashboard, each MR row has a **View log** button under the **Live**
column. It opens a slide-out with the association / auth / DHCP / disassociation
events for that single AP. The default window comes from the **Wireless
connection-log default window** lens (1 h / 12 h / 24 h / 7 d); you can change
the window from the sidecar itself for the current view.

### Wi-Fi correlation for ThousandEyes Endpoint Agents

Each endpoint agent row gains a **Wi-Fi** column showing a colored pill:

- **Green** — healthy: matched to an MR, RSSI better than the amber threshold,
  no recent failures.
- **Amber** — weak RSSI (worse than amber threshold) **or** one or two recent
  association / auth / DHCP failures on the matched MR.
- **Red** — poor RSSI (worse than red threshold) **or** three or more recent
  failures on the matched MR.
- **Neutral / —** — endpoint is wired, ThousandEyes did not report Wi-Fi
  details, or the snapshot pre-dates the correlator feature (re-run TE ingest
  from **Admin → Run job**).

The pill reads left-to-right as `<SSID> · <MR name> · <RSSI dBm>`.

Hover for a tooltip with the matched MR serial, RSSI, PHY mode, and recent
failure count. Click **Open AP log →** to jump to that MR's Wireless
Connection Log pre-scoped to the right serial. Open the row's **Endpoint
agent** detail sidecar to see the full correlation block — connection type,
SSID, **Access point** (the matched MR's name, with a **via BSSID** badge
when the BSSID fallback fired because TE did not expose the endpoint's
client MAC, typical on Android / iOS / managed-MAC devices), BSSID, RSSI,
**PHY mode** (e.g. 802.11ac / 802.11ax), channel, and a recent Meraki
event timeline.

Tone thresholds are admin-configurable in **Admin → Lenses & data → Wi-Fi
impact thresholds** (Amber and Red dBm values).

> **Why no SNR or channel-width cells?** The ThousandEyes Endpoint Agents
> API v7.0.91 schema only contracts `bssid`, `ssid`, `rssi`, `channel`,
> and `phyMode` on `WirelessProfile`. SNR and channel width are not part
> of the spec, so those cells were always empty on spec-compliant agents
> and were removed in v1.3.0. Likewise, the client MAC is not part of
> the spec — that is why the BSSID fallback is the only way to correlate
> mobile / managed-MAC endpoints to an MR.

### Endpoint Agent inventory (v1.3.0)

Open any endpoint agent row's **Details** button to see a slide-out with
the agent's full inventory captured from the TE Endpoint Agents API root
payload:

- **Serial number** — hardware-issued identifier
- **NIC model** and **NIC driver version** — strongest on Windows, often
  null on macOS / mobile
- **Battery level** and **battery health** — normalized 0–100 % on
  laptops and mobile devices, null on desktops without a battery
- **Free disk** — normalized free space percentage
- **License** — `essentials` / `advantage` / `embedded` per TE's
  `AgentLicenseType` enum
- **Agent version** — annotated `(target X.Y.Z)` when TE returns both
  the current and recommended client version, surfacing drift at a glance
- **NPCAP driver** — Windows packet-capture driver version

Each row prefers the live per-agent payload and falls back to the snapshot
inventory so the sidecar renders even when the live ThousandEyes fetch is
rate-limited. Inventory data also feeds the hover tooltip on the endpoint
agent table's hostname column, and a monospace `SN <serial>` subtitle
renders under the hostname when present — no new column was added so
existing layouts stay clean.

## Locations and Circuits

- **Locations** and **Circuits** tabs: **Organization Admins** and **Location & Circuit**
  users can add, edit, and delete. **User** role is **read-only** (view tables and
  details; no discover/import or destructive actions).
- **Tags**: **Organization Admins** and **Location & Circuit** users only.

## Bulk circuit import

Available to **Organization Admins** and **Location & Circuit** users on the Circuits
page.

- Paste or upload CSV. Columns: location, provider, circuit type, circuit ID, download
  Mbps, upload Mbps, and any free-form tags.
- Preview highlights new vs. updated rows and surfaces validation errors inline.
- Imports are **idempotent** — re-importing the same CSV (same import ID) will not
  duplicate rows.
- CSV cells starting with `=`, `+`, `-`, `@`, tab, or CR are automatically prefixed with a
  single apostrophe to protect downstream Excel / LibreOffice users from formula
  injection.

## Admin → Wireless Capacity

Organization admins can manage the **model → max-clients** matrix used by the
Wireless Health sidecar. The page lists every Meraki AP model with its
configured client cap; **Add model** appends a new row, the pencil icon edits an
existing row, and the trash icon removes one (the server refuses changes for
non-org-admins and rejects payloads outside sensible bounds). Empty cells fall
back to a baked-in default per model so the sidecar still has a denominator
when no override exists.

## Reporting

- Open to all authenticated roles; content reflects data the user can already access.

## Session keep-alive

The UI periodically calls `/api/session/ping`. The interval comes from **Admin → Heartbeat
interval** (organization admins). **Session idle timeout** is configurable there; align
with your security policy. Sessions are stored in Postgres and survive server restarts,
but an idle session still expires per the configured timeout.

## SSO

When OIDC is enabled server-side and in Admin, use **Continue with SSO** on the login
page. New users logging in via SSO get a local user record with the **User** role by
default; an organization admin can promote them under **User admin**.

## TLS rotation

Upload new certificate and key under **Admin → TLS certificate upload** (organization
admins). Uploads are validated before they replace the files on disk — expired certs,
weak keys (RSA < 2048, EC < P-256), MD5 / SHA-1 signatures, and cert/key pairs that do
not match are all rejected. Update `TLS_CERT_PATH` / `TLS_KEY_PATH` in `.env` if paths
change, set `HTTPS_ENABLED=true`, and **restart** the Node process.

## Troubleshooting

- **Ingest runs** (Admin → Recent ingest) show `skipped` if API keys are missing, or
  `error` with a short message.
- **Retention**: a daily job deletes `MetricSnapshot` rows older than **Retention
  (days)**. **Run retention purge now** runs it immediately (organization admins).
- Ensure the server can reach Meraki and ThousandEyes over HTTPS (corporate firewall /
  proxy).
- If a **User** sees empty dashboard cards, snapshots may not have run yet; an
  organization admin should confirm API keys and ingest (see Admin). Read-only users
  cannot open Admin to trigger re-sync themselves.
- **"Invalid environment: CREDENTIALS_MASTER_KEY ..."** on startup means your key is
  missing or below 32 characters. See
  [RUNBOOK_CREDENTIAL_ROTATION.md](./RUNBOOK_CREDENTIAL_ROTATION.md).
- **500 response with a `requestId`** — the server hides internal error details by
  design; capture the `requestId` from the response body and check the server logs for
  the matching `reqId` on the `unhandled error returned 500` line.
- **Endpoint Wi-Fi pill shows `—` for every agent** — the snapshot pre-dates the
  correlator feature. Trigger a fresh TE ingest from **Admin → Run job**. If the
  pill still shows `—` only for some agents (typically Android / iOS), TE didn't
  expose those endpoints' client MAC and the BSSID fallback couldn't match the
  BSSID to a known MR — either the AP is non-Meraki or it belongs to a
  different Meraki org. Organization admins can hit
  `GET /api/dashboard/sites/:siteId/endpoint-agents/:agentId/wireless-debug`
  to inspect the raw TE payload, the extracted snapshot, and the persisted
  correlation for that agent.

## Source code

The application source is maintained on GitHub:
[github.com/emahnken-Cisco/Retail-Dashboard](https://github.com/emahnken-Cisco/Retail-Dashboard).
