# Retail Operations Dashboard

Self-hosted Node.js dashboard for retail sites integrating **Cisco Meraki** (MX/MR) and **ThousandEyes** enterprise agents, with Postgres/Supabase storage, optional OIDC (e.g. Cisco SSO), encrypted API credentials, and optional Google Maps.

**Current version:** 1.2.0 — see [CHANGELOG.md](CHANGELOG.md) for details.

The 1.2.0 release adds **DHCP** and **Wireless health** sidecars, a per-MR
**Wireless Connection Log** slide-out, an admin **Wireless Capacity** matrix,
and a **TE Endpoint Agent ↔ Meraki MR** Wi-Fi correlation that matches
endpoints to their AP via client-MAC or BSSID and flags poor RSSI / DHCP /
association failures as "impacted on Wi-Fi".

**Repository:** [github.com/emahnken-Cisco/Retail-Dashboard](https://github.com/emahnken-Cisco/Retail-Dashboard)

```bash
git clone https://github.com/emahnken-Cisco/Retail-Dashboard.git
```

## Security

The 1.1.0 release shipped a full security hardening pass. Highlights:

- **Credential vault**: AES-256-GCM over a scrypt-derived key from `CREDENTIALS_MASTER_KEY`
  and `CREDENTIALS_SALT`; minimum 32-character master key enforced at boot.
- **Session management**: persistent Prisma-backed session store, `__Host-` cookie prefix
  in production, session regeneration on every authentication.
- **CSRF defense**: strict CORS allow-list plus a server-side Origin-guard on every
  mutating request.
- **Login protection**: per-IP rate limiting plus a per-account 5-in-15 throttle;
  12-char password minimum with common-password block-list.
- **SSRF defense** for OIDC issuer URLs and any outbound HTTP using admin-provided URLs.
- **TLS upload validation** (format, validity window, key strength, signature algorithm,
  cert-key match).
- **CSV formula-injection escaping** on all exports.
- **Last-ORG_ADMIN deletion guard**, generic 5xx error responses with correlation IDs.

See [docs/SECURITY.md](docs/SECURITY.md) for the full inventory.

Operational baseline for any deployment:

- **Never commit** `.env`, private keys, or API tokens. This repository must stay free of
  secrets.
- Use [`env.example`](env.example) as a template; generate a fresh `CREDENTIALS_MASTER_KEY`
  and `CREDENTIALS_SALT` per deployment with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- API keys entered in the admin UI are **encrypted at rest** (AES-256-GCM); the UI only
  shows masked values after save.
- Enable **HTTPS** in production. Prefer a reverse proxy (Caddy / nginx) with a proper CA,
  and set `TRUST_PROXY=true` so rate limiting and secure-cookie detection work correctly.
- Enable **GitHub secret scanning** on
  [the GitHub repository](https://github.com/emahnken-Cisco/Retail-Dashboard) (or your
  fork). Review [docs/CONFIGURATION.md](docs/CONFIGURATION.md) before sharing with
  customers.

## Quick start (development)

1. Node.js 20+ and npm 10+.
2. `cp env.example .env` at the **repository root** (same folder as the root
   `package.json`). Set `DATABASE_URL`, generate a real `CREDENTIALS_MASTER_KEY` and
   `CREDENTIALS_SALT`, and set `SESSION_SECRET`. Prisma loads this file via `dotenv-cli`; a
   root `.env` is required for `npm run db:migrate`.
3. `docker compose up -d` (optional local Postgres) or point `DATABASE_URL` at Supabase.
4. `npm install` (runs `prisma generate` via `postinstall`; uses
   [`scripts/prisma-generate.cjs`](scripts/prisma-generate.cjs) so paths with **spaces**
   work on Windows).
5. `npm run db:migrate`
6. `npm run dev` — API on port 3001, web on 5173.

First visit: complete setup at `/setup` if no admin user exists, then sign in. Passwords
set through setup / bootstrap / user admin must be at least 12 characters and not a
common password.

## Documentation

- [Deployment (Linux VM)](docs/DEPLOYMENT.md)
- [Configuration reference](docs/CONFIGURATION.md)
- [User guide](docs/USER_GUIDE.md)
- [Security overview](docs/SECURITY.md)
- [Credential rotation runbook](docs/RUNBOOK_CREDENTIAL_ROTATION.md)
- [Changelog](CHANGELOG.md)

## License

This project is licensed under the [MIT License](LICENSE).
