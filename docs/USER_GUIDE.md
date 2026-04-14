# User guide

## Startup flow

1. **Install** the app on a Linux VM (see [DEPLOYMENT.md](./DEPLOYMENT.md)) or run it locally for development.
2. **Configure** `.env` and run database migrations.
3. **First access**: open the web UI. If no user exists, complete **Initial setup** or use bootstrap credentials from `.env` (see [CONFIGURATION.md](./CONFIGURATION.md)). The first account is an **Organization Admin**.
4. **API keys** (**Admin → API keys**): add Meraki Dashboard API key and ThousandEyes OAuth bearer token. Use **Test connection** where available. Only **Organization Admins** see this page.
5. **Locations**: add each retail location; set **Meraki network ID** to match the network that contains MX/MR at that site; set **ThousandEyes tag** to a substring that appears in the enterprise agent name for that site. Or use **Discover from ThousandEyes + Meraki** on the Locations page (editors only) to pull enterprise agents, auto-match Meraki networks, enrich lat/lng, preview payloads, and bulk-import selected rows.
6. **Admin → Lenses** (organization admins): toggle Meraki / ThousandEyes panels, map, and **card columns** (1–6). Enable **Google Maps** and save a Maps JavaScript API key on the **API keys** page if you want the map.
7. **Wait** for the scheduler (or use **Full re-sync** in Admin) to populate snapshots.

## Roles and navigation

| Role | Typical use | What you see |
|------|-------------|----------------|
| **Organization Admin** | Full control | **Admin** (Settings, User admin, API keys), **Locations**, **Circuits**, **Tags**, **Reporting**, **Dashboard**, **API debug** (full, including clear outbound traces). |
| **Location & Circuit** | Site and circuit operators | **Locations**, **Circuits**, **Tags**, **Reporting**, **Dashboard**, **API debug** (read-oriented; no Admin block, no API keys). |
| **User** | View-only / reporting | **Dashboard**, **Locations**, **Circuits**, **Reporting** only — no Admin, Tags, API keys, or API debug. |

**User admin** (**Admin → User admin**): organization admins can list users, create accounts (email, password, role), update roles, and remove users (not themselves).

## Dashboard

- Available to **all signed-in roles**. It shows ingested data only; it does not require Admin settings to load (the app uses a dedicated read endpoint for lens/map options).
- **Location cards** show the latest Meraki and ThousandEyes payloads per site (when enabled in lenses).
- **Map** plots sites that have latitude/longitude (manual on the Locations page and/or Meraki geo from snapshots).
- **Refresh** reloads data from the API (not a new Meraki/TE poll). Auto-refresh can update site list data while the tab is visible.

## Locations and Circuits

- **Locations** and **Circuits** tabs: **Organization Admins** and **Location & Circuit** users can add, edit, and delete. **User** role is **read-only** (view tables and details; no discover/import or destructive actions).
- **Tags**: **Organization Admins** and **Location & Circuit** users only.

## Reporting

- Open to all authenticated roles; content reflects data the user can already access.

## Session keep-alive

The UI periodically calls `/api/session/ping`. The interval comes from **Admin → Heartbeat interval** (organization admins). **Session idle timeout** is configurable there; align with your security policy.

## SSO

When OIDC is enabled server-side and in Admin, use **Continue with SSO** on the login page. New users logging in via SSO get a local user record with the **User** role by default; an organization admin can promote them under **User admin**.

## TLS rotation

Upload new certificate and key under **Admin → TLS certificate upload** (organization admins), update `TLS_CERT_PATH` / `TLS_KEY_PATH` in `.env` if paths change, set `HTTPS_ENABLED=true`, and **restart** the Node process.

## Troubleshooting

- **Ingest runs** (Admin → Recent ingest) show `skipped` if API keys are missing, or `error` with a short message.
- **Retention**: a daily job deletes `MetricSnapshot` rows older than **Retention (days)**. **Run retention purge now** runs it immediately (organization admins).
- Ensure the server can reach Meraki and ThousandEyes over HTTPS (corporate firewall / proxy).
- If a **User** sees empty dashboard cards, snapshots may not have run yet; an organization admin should confirm API keys and ingest (see Admin). Read-only users cannot open Admin to trigger re-sync themselves.

## Source code

The application source is maintained on GitHub: [github.com/emahnken-Cisco/Retail-Dashboard](https://github.com/emahnken-Cisco/Retail-Dashboard).
