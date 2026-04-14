# Deployment (Linux VM)

## Prerequisites

- Ubuntu 22.04 LTS or similar, 2+ GB RAM
- Node.js 20 LTS (`node -v`)
- PostgreSQL 14+ **or** a Supabase project (Postgres connection string), **or** Docker for [optional local Postgres](#optional-local-postgres-docker) during development
- Outbound HTTPS to `api.meraki.com`, `api.thousandeyes.com` (app uses **ThousandEyes REST API v7** at `https://api.thousandeyes.com/v7`), and optionally Google Maps APIs

## 1. Install application

```bash
git clone https://github.com/emahnken-Cisco/Retail-Dashboard.git retail-dashboard
cd retail-dashboard
cp env.example .env
```

Edit `.env`:

- `DATABASE_URL` — Postgres or Supabase URI (use the **direct** or **session** connection string Supabase documents for server apps).
- `CREDENTIALS_MASTER_KEY` — 32-byte base64: `openssl rand -base64 32`
- `SESSION_SECRET` — long random string (32+ characters)
- `PUBLIC_URL` — public base URL of the **API** (e.g. `https://dashboard.example.com`)
- `FRONTEND_URL` — same origin if you serve the SPA from Node; if split, the browser origin (e.g. `https://app.example.com`)
- Optional HTTPS: `HTTPS_ENABLED=true`, `TLS_CERT_PATH`, `TLS_KEY_PATH` (see [CONFIGURATION.md](./CONFIGURATION.md))

## Optional: local Postgres (Docker)

On a workstation or CI, you can run Postgres from the repo root:

```bash
docker compose up -d
```

Set `DATABASE_URL` to match the Compose defaults (see [CONFIGURATION.md](./CONFIGURATION.md) and [`docker-compose.yml`](../docker-compose.yml)). For production on a VM, prefer a local PostgreSQL install or a managed database instead of binding port `5432` publicly.

## 2. Database

```bash
npm ci
npm run db:migrate
```

Migrations add schema changes over time (including RBAC `UserRole` on `User`). Always run migrate after pulling updates.

## 3. Build and run

```bash
npm run build
node apps/server/dist/index.js
```

For production, use **systemd** (two units optional: API + worker is not split in this MVP—the scheduler runs in-process).

Example `systemd` service:

```ini
[Unit]
Description=Retail Operations Dashboard
After=network.target

[Service]
Type=simple
User=retail
WorkingDirectory=/opt/retail-dashboard
EnvironmentFile=/opt/retail-dashboard/.env
ExecStart=/usr/bin/node apps/server/dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## 4. Reverse proxy (recommended)

Terminating TLS in **Caddy** or **nginx** is often easier than rotating certs in Node. Proxy `/` to the Node process (port 3001 or your `PORT`), forward `X-Forwarded-*` headers, and set `PUBLIC_URL`/`FRONTEND_URL` to the HTTPS URLs users see.

## 5. First login and roles

1. Open the app in a browser (same host as `FRONTEND_URL` if using OIDC redirects).
2. Complete **Initial setup** if prompted (creates the first **Organization Admin** user), or rely on `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` in `.env` (also **Organization Admin**).
3. Configure Meraki and ThousandEyes keys under **Admin → API keys** (organization admins only).
4. Use **Admin → User admin** to invite additional users and assign **Organization Admin**, **Location & Circuit**, or **User (read-only)** as needed.

See [USER_GUIDE.md](./USER_GUIDE.md) for roles and day-to-day use.
