# Retail Operations Dashboard

Self-hosted Node.js dashboard for retail sites integrating **Cisco Meraki** (MX/MR) and **ThousandEyes** enterprise agents, with Postgres/Supabase storage, optional OIDC (e.g. Cisco SSO), encrypted API credentials, and optional Google Maps.

**Repository:** [github.com/emahnken-Cisco/Retail-Dashboard](https://github.com/emahnken-Cisco/Retail-Dashboard)

```bash
git clone https://github.com/emahnken-Cisco/Retail-Dashboard.git
```

## Security

- **Never commit** `.env`, private keys, or API tokens. This repository must stay free of secrets.
- Use `env.example` as a template; generate `CREDENTIALS_MASTER_KEY` once per deployment.
- API keys entered in the admin UI are **encrypted at rest** (AES-256-GCM); the UI only shows masked values after save.
- Enable **HTTPS** in production. Prefer a reverse proxy (Caddy/nginx) with a proper CA, or use the bundled self-signed tooling for lab use only.
- Enable **GitHub secret scanning** on [the GitHub repository](https://github.com/emahnken-Cisco/Retail-Dashboard) (or your fork). Review `docs/CONFIGURATION.md` before sharing with customers.

## Quick start (development)

1. Node.js 20+ and npm 10+.
2. `cp env.example .env` at the **repository root** (same folder as the root `package.json`) — set `DATABASE_URL`, `CREDENTIALS_MASTER_KEY`, `SESSION_SECRET`. Prisma loads this file via `dotenv-cli`; a root `.env` is required for `npm run db:migrate`.
3. `docker compose up -d` (optional local Postgres) or point `DATABASE_URL` at Supabase.
4. `npm install` (runs `prisma generate` via `postinstall`; uses [`scripts/prisma-generate.cjs`](scripts/prisma-generate.cjs) so paths with **spaces** work on Windows).
5. `npm run db:migrate`
6. `npm run dev` — API on port 3001, web on 5173.

First visit: complete setup at `/setup` if no admin user exists, then sign in.

## Documentation

- [Deployment (Linux VM)](docs/DEPLOYMENT.md)
- [Configuration reference](docs/CONFIGURATION.md)
- [User guide](docs/USER_GUIDE.md)

## License

This project is licensed under the [MIT License](LICENSE).
