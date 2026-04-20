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

Edit `.env`. Minimum required:

- `DATABASE_URL` — Postgres or Supabase URI (use the **direct** or **session** connection
  string Supabase documents for server apps).
- `CREDENTIALS_MASTER_KEY` — **≥32 characters**. Generate a 32-byte base64 value:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```

  or `openssl rand -base64 32`. Do **not** leave the template placeholder in place — the
  server will refuse to start at boot.

- `CREDENTIALS_SALT` — **recommended on new installs**. Another random 32-byte base64 value
  (different from the master key). Prevents a cross-install pre-computation attack.

- `SESSION_SECRET` — long random string (≥32 characters).

- `PUBLIC_URL` — public base URL of the **API** (e.g. `https://dashboard.example.com`).

- `FRONTEND_URL` — same origin if you serve the SPA from Node; if split, the browser origin
  (e.g. `https://app.example.com`).

- Optional HTTPS: `HTTPS_ENABLED=true`, `TLS_CERT_PATH`, `TLS_KEY_PATH` (see
  [CONFIGURATION.md](./CONFIGURATION.md)).

Secure the `.env` file: `chmod 600 .env` and confirm it is git-ignored
(`git ls-files --error-unmatch .env` should exit non-zero).

## Optional: local Postgres (Docker)

On a workstation or CI, you can run Postgres from the repo root:

```bash
docker compose up -d
```

Set `DATABASE_URL` to match the Compose defaults (see
[CONFIGURATION.md](./CONFIGURATION.md) and [`docker-compose.yml`](../docker-compose.yml)).
For production on a VM, prefer a local PostgreSQL install or a managed database instead of
binding port `5432` publicly.

## 2. Database

```bash
npm ci
npm run db:migrate
```

Migrations add schema changes over time (including RBAC `UserRole` on `User`, the
`Session` persistent-session-store table introduced in 1.1.0, and the
`CircuitImport` idempotency table). Always run migrate after pulling updates.

## 3. Build and run

```bash
npm run build
node apps/server/dist/index.js
```

For production, use **systemd** (two units optional: API + worker is not split in this
MVP — the scheduler runs in-process).

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
# Recommended hardening:
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/opt/retail-dashboard/apps/server/certs
RestrictSUIDSGID=yes
UMask=0077

[Install]
WantedBy=multi-user.target
```

Check file permissions on `/opt/retail-dashboard/.env` — `chmod 600` with owner `retail`.

## 4. Reverse proxy (recommended)

Terminating TLS in **Caddy** or **nginx** is often easier than rotating certs in Node.
Proxy `/` to the Node process (port 3001 or your `PORT`), forward `X-Forwarded-*` headers,
and set `PUBLIC_URL` / `FRONTEND_URL` to the HTTPS URLs users see.

**Important**: when behind a proxy, set `TRUST_PROXY=true` in `.env`. Without it:

- Rate limiting blocks / allows based on the proxy's IP instead of the real client IP.
- Fastify may not detect HTTPS correctly, which can break `Secure` cookie detection on
  the session cookie.
- `req.log` entries show the proxy IP instead of the client IP, hurting incident response.

Example NGINX snippet:

```nginx
location / {
    proxy_pass         http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   X-Forwarded-Host  $host;
    proxy_read_timeout 90s;
}
```

Example Caddyfile:

```
dashboard.example.com {
    reverse_proxy 127.0.0.1:3001
    encode gzip
}
```

## 5. First login and roles

1. Open the app in a browser (same host as `FRONTEND_URL` if using OIDC redirects).
2. Complete **Initial setup** if prompted (creates the first **Organization Admin** user),
   or rely on `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` in `.env` (also
   **Organization Admin**). The bootstrap password must satisfy the password policy
   (≥12 chars, not a common password).
3. If you used the bootstrap env vars, **remove them from `.env`** once you have logged
   in, then restart. The server will log a boot warning otherwise.
4. Configure Meraki and ThousandEyes keys under **Admin → API keys** (organization admins
   only).
5. Use **Admin → User admin** to invite additional users and assign **Organization
   Admin**, **Location & Circuit**, or **User (read-only)** as needed.

See [USER_GUIDE.md](./USER_GUIDE.md) for roles and day-to-day use.

## 6. Production hardening checklist

- [ ] `.env` has real values for `CREDENTIALS_MASTER_KEY` (≥32 chars, random base64) and
      `CREDENTIALS_SALT`.
- [ ] `.env` is `chmod 600`, owned by the service user, git-ignored.
- [ ] Reverse proxy terminates TLS; `TRUST_PROXY=true`.
- [ ] `NODE_ENV=production`; session cookie is `__Host-rsid` and has `Secure` + `HttpOnly`
      + `SameSite=Lax`.
- [ ] `PUBLIC_URL` and `FRONTEND_URL` are the HTTPS origins users actually hit;
      `ALLOWED_ORIGINS` includes any additional staging / preview hostnames.
- [ ] If OIDC is enabled, set `OIDC_ISSUER_ALLOWLIST` to the exact issuer origin(s) you
      trust.
- [ ] Postgres is not exposed to untrusted networks; backups are encrypted at rest.
- [ ] `ADMIN_BOOTSTRAP_*` env vars are removed after first login.
- [ ] Secret scanning is enabled on the GitHub repository.

## 7. Operational runbooks

- [Credential rotation](./RUNBOOK_CREDENTIAL_ROTATION.md) — rotate
  `CREDENTIALS_MASTER_KEY` / `CREDENTIALS_SALT` without losing stored API keys.
- [Security overview](./SECURITY.md) — full inventory of controls and known gaps.
