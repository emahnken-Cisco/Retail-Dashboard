# Configuration reference

All sensitive values belong in `.env` on the server, **never** in git.

## Core

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Supabase-compatible). To create a dedicated DB + user on your own Postgres, run [`scripts/postgres/01-create-role-and-database.sql`](../scripts/postgres/01-create-role-and-database.sql) on DB `postgres`, then [`scripts/postgres/02-grants-in-retail-dashboard.sql`](../scripts/postgres/02-grants-in-retail-dashboard.sql) on DB `retail_dashboard` (see [`scripts/postgres/README.md`](../scripts/postgres/README.md)). |
| `CREDENTIALS_MASTER_KEY` | **≥32 characters.** Used to derive the AES-256-GCM key for the credential vault. A random 32-byte base64 value is strongly preferred over a passphrase. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Rotating this value invalidates every stored provider credential — see [RUNBOOK_CREDENTIAL_ROTATION.md](./RUNBOOK_CREDENTIAL_ROTATION.md). |
| `CREDENTIALS_SALT` | **Recommended on new installs.** ≥16-character per-install salt for the scrypt KDF over `CREDENTIALS_MASTER_KEY`. When unset, the server falls back to a documented legacy salt and logs `cryptoVault: using fallback salt` at boot (safe but shared across every install of this app). Generate with the same `crypto.randomBytes` command as above. |
| `SESSION_SECRET` | **≥32 characters.** Secret for signing session cookies. |
| `NODE_ENV` | `development` or `production`. Production enables `Secure` cookies and the `__Host-` cookie prefix, and suppresses internal error details in 5xx responses. |
| `HOST` | Bind address (default `0.0.0.0`). |
| `PORT` | HTTP(S) port (default `3001`). |
| `PUBLIC_URL` | Public base URL of the API (no trailing slash). Used for OIDC callback construction and as the first entry in the browser-origin allow-list. |
| `FRONTEND_URL` | Browser origin after SSO (e.g. `http://localhost:5173` in dev with Vite proxy). Added to the browser-origin allow-list. |

## Browser origin / CSRF hardening

| Variable | Description |
|----------|-------------|
| `ALLOWED_ORIGINS` | Optional comma-separated list of **additional** origins allowed for cross-origin browser requests (CORS + Origin-guard). Use for staging / preview deployments. Example: `https://staging-api.example.com,https://preview-app.example.com`. Never set to `*` — the server explicitly rejects that. |
| `TRUST_PROXY` | Set to `true` when the app runs behind a reverse proxy (NGINX, ALB, Cloudflare, Caddy). Required for accurate `req.ip` (rate limiting), `req.protocol` (secure-cookie detection), and `X-Forwarded-*` handling. Leave unset (default `false`) when the Node process faces users directly. |

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
| `HTTPS_ENABLED` | `true` to serve HTTPS directly from Node. In combination with `NODE_ENV=production`, the session cookie switches to the `__Host-rsid` name (`__Host-` prefix enforces `Secure`, `Path=/`, no `Domain`). |
| `TLS_CERT_PATH` | Path to PEM certificate. |
| `TLS_KEY_PATH` | Path to PEM private key. |

You can upload new PEM files from **Admin → TLS certificate upload**. Uploads are validated
for format, X.509 validity window (not expired, not far-future), key strength (RSA ≥2048,
EC ≥P-256), signature algorithm (no MD5 / SHA-1), and cert-key pair match before being
written. Copy the returned paths into `.env` and restart.

Self-signed generation (Linux/macOS):

```bash
chmod +x scripts/generate-self-signed.sh
./scripts/generate-self-signed.sh ./apps/server/certs
```

## Optional OIDC (e.g. Cisco IdP)

| Variable | Description |
|----------|-------------|
| `OIDC_ENABLED` | `true` to expose SSO routes. |
| `OIDC_ISSUER_URL` | Issuer URL. Validated at login and at admin-UI save time against the SSRF guard: must be HTTPS, must not resolve to a private / reserved / link-local / cloud-metadata address, must not be a block-listed hostname (`localhost`, `*.internal`, etc.). Can be overridden in **Admin → Settings**. |
| `OIDC_ISSUER_ALLOWLIST` | **Optional defense-in-depth.** Comma-separated list of origin values (`https://host[:port]`) that are the only issuers the server will accept, even if an ORG_ADMIN changes `oidcIssuerUrl` in the admin UI. Example: `https://idp.example.com,https://cisco.idp.example.com`. Leave unset to allow any public HTTPS issuer that passes the SSRF guard. |
| `OIDC_CLIENT_ID` | OAuth client ID. |
| `OIDC_CLIENT_SECRET` | Client secret (keep in `.env` only; never in the admin UI if avoidable). |
| `OIDC_CALLBACK_PATH` | Default `/api/auth/oidc/callback`. |

Enable **SSO (OIDC)** in **Admin → Settings** after setting server env vars. Register the
redirect URI: `{PUBLIC_URL}{OIDC_CALLBACK_PATH}`.

## Optional bootstrap user

| Variable | Description |
|----------|-------------|
| `ADMIN_BOOTSTRAP_EMAIL` | If **no users exist** at startup, create this user automatically. |
| `ADMIN_BOOTSTRAP_PASSWORD` | Plain password. **Must satisfy the password policy** (≥12 chars, not in the common-password list); otherwise the server exits at boot with an error. |

The bootstrap account is created as **Organization Admin**. After a successful bootstrap,
the server logs a warning instructing the operator to **unset both env vars**. If the env
vars remain set after users already exist, the server logs a warning every boot because
they're no longer doing anything.

## Access control (RBAC)

Roles are stored **in the database** (`User.role`), not in `.env`. There is no separate
role env var for day-to-day operation.

| Role | Purpose (summary) |
|------|-------------------|
| **Organization Admin** | Full **Admin** (settings, ingest, lenses, OIDC fields, TLS), **User admin** (`/admin/users`), **API keys**, **Tags**, **API debug** (including clearing outbound traces). |
| **Location & Circuit** | Create/edit **Locations**, **Circuits**, and **Tags**; read **API debug** (no admin settings, no user admin, no API keys page). |
| **User** | Read-only **Dashboard**, **Locations**, **Circuits**, and **Reporting**; no Admin, Tags, API keys, or API debug. |

- **Initial setup** (`/setup`) and the first user created there are **Organization Admin**.
- **SSO (OIDC)** users created on first login default to **User**; an organization admin can
  change roles under **Admin → User admin**.
- The server blocks the operation that would leave zero `ORG_ADMIN` users
  (both `DELETE /api/admin/users/:id` and role-changing `PATCH`).

API details: `GET /api/auth/me` returns `id`, `email`, `role`. The main dashboard reads
lens/map flags from `GET /api/dashboard/ui-config` (any authenticated user), not from
`GET /api/admin/settings` (admins only).

## Password policy

Applied on **Initial setup**, **Admin → User admin** (create / change password), and
bootstrap.

- Minimum length: **12 characters**.
- Rejects common / weak passwords (built-in block-list).
- No upper-bound on length, no mandatory character-class rules (NIST-style — length beats
  composition).

## Login throttling

Two layers:

1. **Per-IP rate limit** on `/api/auth/login`: 10 requests / min.
2. **Per-account throttle**: 5 failed attempts within 15 min on the same account lock that
   **account identifier** out for 15 minutes, regardless of source IP. Defeats
   distributed credential-stuffing attacks that cycle IPs.

The per-account throttle is currently in-process (resets on restart). Acceptable for
single-node deployments; a multi-node scale-out would need to back this with the DB or
Redis.

## Polling and retention (also in Admin UI)

Stored in `AdminSettings`: `retentionDays` (default 90), `pollIntervalMerakiSec`,
`pollIntervalTESec`, `heartbeatIntervalSec`, `sessionIdleTimeoutMin`, and **lenses** JSON
(widgets, map, card columns). Only **Organization Admins** can change these in the UI.

## GitHub hygiene

- Upstream source: [github.com/emahnken-Cisco/Retail-Dashboard](https://github.com/emahnken-Cisco/Retail-Dashboard) (`git clone https://github.com/emahnken-Cisco/Retail-Dashboard.git`).
- Commit **lockfiles**; run `npm audit` regularly.
- Enable **Secret scanning** on the repository.
- Never commit `.env`, `*.pem`, `*.key`, or exports containing API keys.

## Related documentation

- [Security overview](./SECURITY.md) — full inventory of security controls.
- [Credential rotation runbook](./RUNBOOK_CREDENTIAL_ROTATION.md) — how to rotate
  `CREDENTIALS_MASTER_KEY` / `CREDENTIALS_SALT`.
- [Deployment guide](./DEPLOYMENT.md) — Linux VM install, reverse proxy, systemd.
- [User guide](./USER_GUIDE.md) — roles, dashboard, circuits and locations.
