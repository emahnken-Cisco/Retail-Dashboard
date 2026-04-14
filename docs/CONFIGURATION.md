# Configuration reference

All sensitive values belong in `.env` on the server, **never** in git.

## Core

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Supabase-compatible). To create a dedicated DB + user on your own Postgres, run [`scripts/postgres/01-create-role-and-database.sql`](../scripts/postgres/01-create-role-and-database.sql) on DB `postgres`, then [`scripts/postgres/02-grants-in-retail-dashboard.sql`](../scripts/postgres/02-grants-in-retail-dashboard.sql) on DB `retail_dashboard` (see [`scripts/postgres/README.md`](../scripts/postgres/README.md)). |
| `CREDENTIALS_MASTER_KEY` | Base64-encoded 32-byte key for AES-256-GCM encryption of API tokens stored in the database. |
| `SESSION_SECRET` | Secret for signing session cookies (32+ characters). |
| `NODE_ENV` | `development` or `production`. |
| `HOST` | Bind address (default `0.0.0.0`). |
| `PORT` | HTTP(S) port (default `3001`). |
| `PUBLIC_URL` | Base URL of the API (no trailing slash), used for OIDC callback URLs. |
| `FRONTEND_URL` | Browser origin after SSO (e.g. `http://localhost:5173` in dev with Vite proxy). |

## Local PostgreSQL (Docker Compose)

Optional dev database from the repo root:

```bash
docker compose up -d
```

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | **Optional.** If set in `.env`, Docker Compose uses it for the `postgres` service (see [`docker-compose.yml`](../docker-compose.yml)). Must match the password embedded in `DATABASE_URL`. Default in Compose: `retail_dev_change_me`. |

Example `DATABASE_URL` when using the default Compose credentials:

```text
postgresql://retail:retail_dev_change_me@localhost:5432/retail_dashboard?schema=public
```

Do not expose Postgres port `5432` to untrusted networks in production.

## HTTPS

| Variable | Description |
|----------|-------------|
| `HTTPS_ENABLED` | `true` to serve HTTPS directly from Node. |
| `TLS_CERT_PATH` | Path to PEM certificate. |
| `TLS_KEY_PATH` | Path to PEM private key. |

You can upload new PEM files from **Admin → TLS certificate upload**; copy the returned paths into `.env` and restart.

Self-signed generation (Linux/macOS):

```bash
chmod +x scripts/generate-self-signed.sh
./scripts/generate-self-signed.sh ./apps/server/certs
```

## Optional OIDC (e.g. Cisco IdP)

| Variable | Description |
|----------|-------------|
| `OIDC_ENABLED` | `true` to expose SSO routes. |
| `OIDC_ISSUER_URL` | Issuer URL (can be overridden in Admin UI). |
| `OIDC_CLIENT_ID` | OAuth client ID. |
| `OIDC_CLIENT_SECRET` | Client secret (keep in `.env` only). |
| `OIDC_CALLBACK_PATH` | Default `/api/auth/oidc/callback`. |

Enable **SSO (OIDC)** in Admin after setting server env vars. Register the redirect URI: `{PUBLIC_URL}{OIDC_CALLBACK_PATH}`.

## Optional bootstrap user

| Variable | Description |
|----------|-------------|
| `ADMIN_BOOTSTRAP_EMAIL` | If no users exist, create this user on startup. |
| `ADMIN_BOOTSTRAP_PASSWORD` | Plain password (change after first login). |

The bootstrap account is created as **Organization Admin** so it can manage settings and other users.

## Access control (RBAC)

Roles are stored **in the database** (`User.role`), not in `.env`. There is no separate “role env var” for day-to-day operation.

| Role | Purpose (summary) |
|------|-------------------|
| **Organization Admin** | Full **Admin** (settings, ingest, lenses, OIDC fields, TLS), **User admin** (`/admin/users`), **API keys**, **Tags**, **API debug** (including clearing outbound traces). |
| **Location & Circuit** | Create/edit **Locations**, **Circuits**, and **Tags**; read **API debug** (no admin settings, no user admin, no API keys page). |
| **User** | Read-only **Dashboard**, **Locations**, **Circuits**, and **Reporting**; no Admin, Tags, API keys, or API debug. |

- **Initial setup** (`/setup`) and the first user created there are **Organization Admin**.
- **SSO (OIDC)** users created on first login default to **User**; an organization admin can change roles under **Admin → User admin**.

API details: `GET /api/auth/me` returns `id`, `email`, `role`. The main dashboard reads lens/map flags from `GET /api/dashboard/ui-config` (any authenticated user), not from `GET /api/admin/settings` (admins only).

## Polling and retention (also in Admin UI)

Stored in `AdminSettings`: `retentionDays` (default 90), `pollIntervalMerakiSec`, `pollIntervalTESec`, `heartbeatIntervalSec`, `sessionIdleTimeoutMin`, and **lenses** JSON (widgets, map, card columns). Only **Organization Admins** can change these in the UI.

## GitHub hygiene

- Upstream source: [github.com/emahnken-Cisco/Retail-Dashboard](https://github.com/emahnken-Cisco/Retail-Dashboard) (`git clone https://github.com/emahnken-Cisco/Retail-Dashboard.git`).
- Commit **lockfiles**; run `npm audit` regularly.
- Enable **Secret scanning** on the repository.
- Never commit `.env`, `*.pem`, `*.key`, or exports containing API keys.
