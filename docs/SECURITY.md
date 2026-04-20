# Security overview

This document describes the security controls implemented by the Retail Operations
Dashboard as of **1.1.0**. It is the reference for operators and security reviewers; it is
not user-facing end-documentation.

## Threat model (summary)

| Asset | Primary threats | Primary defenses |
|-------|-----------------|------------------|
| User session cookies | XSS, CSRF, session fixation, hijack via proxy | `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix in prod, session regeneration on auth, Origin-guard, persistent Prisma-backed session store |
| Stored provider credentials (Meraki, TE, OIDC secret, etc.) | DB leak / backup theft | AES-256-GCM, scrypt KDF with per-install salt, master key held only in env / vault |
| Application passwords | Credential stuffing, brute force, weak-password reuse | bcrypt hash, 12-char minimum, common-password block-list, per-IP + per-account login throttling |
| Server-to-external calls (OIDC issuer, dashboard webhooks) | SSRF into internal network | HTTPS-only URL guard, private IPv4/IPv6 range block-list, hostname suffix block-list, optional issuer allow-list |
| Admin settings writes | CSRF-style tampering, unauthenticated writes, elevation of privilege | RBAC (`ORG_ADMIN` gate on every mutating admin route), Origin-guard on every mutating request, last-admin deletion guard |
| Uploaded TLS certificates | Arbitrary file write, invalid/expired cert bringing service down | Fieldname allow-list, PEM parse + X.509 validity checks, certificate-key match, time-window + key-strength checks |
| CSV exports | Formula injection into Excel / Numbers / LibreOffice | Explicit prefix escape for `= + - @ \t \r` cells |

## Transport and session

- **HTTPS** can be terminated at a reverse proxy (recommended) or directly by the app
  (`HTTPS_ENABLED=true`). Either way, session cookies use the `Secure` flag in production.
- **`__Host-` cookie prefix** is applied in production (`NODE_ENV=production` and
  `HTTPS_ENABLED=true`): the session cookie is named `__Host-rsid` and the browser enforces
  `Secure`, `Path=/`, and the absence of a `Domain` attribute. Dev and non-TLS builds fall
  back to `rsid`.
- **`TRUST_PROXY=true`** must be set when the app runs behind NGINX / ALB / Cloudflare /
  Caddy, otherwise rate limiting and secure-cookie detection see the proxy IP / scheme
  instead of the client's.
- **Session store**: persistent in Postgres via Prisma (`Session` table). Surviving restarts
  and horizontal scaling, and auditable via SQL. Expired rows are purged on a timer.
- **Session regeneration**: every successful authentication
  (`/api/auth/login`, `/api/auth/oidc/callback`, `/api/setup`) calls
  `req.session.regenerate()` before assigning `req.session.userId`. This defeats session
  fixation.

## CSRF / Origin protection

The browser's `SameSite=Lax` session cookie is the first layer, but it is not sufficient on
its own (subdomain drift, legacy browsers, some mobile wrappers). Two additional layers:

1. **Strict CORS**: `@fastify/cors` is configured with an explicit `ORIGIN_ALLOW_LIST`
   derived from `PUBLIC_URL`, `FRONTEND_URL`, and optionally `ALLOWED_ORIGINS`. Any origin
   not on the list is rejected (no `origin: true`, no `*`).
2. **Origin-guard preHandler** (`apps/server/src/lib/originGuard.ts`): every mutating
   request (POST / PUT / PATCH / DELETE) must carry either an `Origin` or a `Referer`
   header whose origin matches the allow-list. Missing or mismatched → 403 with a generic
   message. The OIDC callback is exempted (redirect from the IdP).

## Authentication

### Local login

- `/api/auth/login` is rate-limited at 10 req/min per IP (route-level `@fastify/rate-limit`).
- Per-account throttle on top of IP throttle: 5 failed attempts in 15 minutes locks that
  account-identifier (not the IP) for 15 minutes. Implemented in
  `apps/server/src/lib/loginThrottle.ts`; fully in-memory today, so it resets on restart.
- Password storage uses **bcrypt** (cost factor from library default 10; tune to target
  ≤1 s verify time on your production hardware).
- Password policy (`apps/server/src/lib/passwordPolicy.ts`):
  - minimum length **12**
  - rejects passwords present in a built-in common-password list
  - applied on `/api/setup`, `/api/admin/users` (create + change password), and bootstrap

### OIDC (SSO)

- Authorization Code flow with **PKCE** (`S256`) and `state`; both are stored in the
  session and verified on callback.
- `OIDC_ISSUER_URL` is validated by the SSRF guard at both
  `/api/auth/oidc/login` and the callback. Non-HTTPS, private-IPv4/IPv6,
  cloud-metadata, and block-listed hostnames are rejected.
- `OIDC_ISSUER_ALLOWLIST` (optional, comma-separated origins) adds an explicit
  allow-list — defense-in-depth against an ORG_ADMIN who edits the issuer in the admin UI.
- OIDC-provisioned users default to role `USER` (read-only). An ORG_ADMIN promotes them
  under Admin → User admin.

### Bootstrap admin

- Activated only when `User` table is empty **and** `ADMIN_BOOTSTRAP_EMAIL` +
  `ADMIN_BOOTSTRAP_PASSWORD` are set.
- Role is explicitly `ORG_ADMIN`.
- Password passes the same password-policy check as UI-created passwords — a weak value
  causes the process to exit with a clear message.
- On first successful bootstrap the server logs a red-boldfaced warning telling the
  operator to unset both env vars. If the env vars remain set while users already exist,
  the server logs a warning every boot flagging the dead weight.

## Authorization (RBAC)

- Role stored in `User.role` enum (`ORG_ADMIN`, `LOCATION_CIRCUIT`, `USER`).
- Enforced server-side via `requireOrgAdmin` / `requireSiteEditor` / `requireTagEditor` /
  `requireDebugReader` pre-handlers. The client hides nav / buttons too, but the server is
  the authority.
- **Last-ORG_ADMIN guard**: `DELETE /api/admin/users/:id` and
  `PATCH /api/admin/users/:id` (role change) refuse the operation if it would leave the
  system with zero `ORG_ADMIN` users. Returns 400.

## Credential vault

`apps/server/src/lib/cryptoVault.ts` implements AES-256-GCM encryption for stored provider
secrets (Meraki API key, TE bearer, OpenWeather, Google Maps, OIDC client secret).

- **Key derivation**: if `CREDENTIALS_MASTER_KEY` is exactly 32 base64-decoded bytes, that
  is used directly as the DEK. Otherwise, scrypt derives a 32-byte DEK from the passphrase
  using `CREDENTIALS_SALT` (or a documented legacy fallback salt if unset).
- **Minimum key length**: 32 characters. Enforced at boot by Zod.
- **Per-install salt**: `CREDENTIALS_SALT` is optional but strongly recommended on new
  installs — it stops an attacker who grabs one DB dump from benefiting from precomputed
  rainbow tables built against the legacy fallback salt.
- **Rotation**: documented in [RUNBOOK_CREDENTIAL_ROTATION.md](./RUNBOOK_CREDENTIAL_ROTATION.md).
  A re-encrypt migration path exists for zero-downtime rotation; cold rotation is the
  default approach.

## SSRF defense for outbound HTTP

`apps/server/src/lib/urlGuard.ts` provides `validateExternalHttpsUrl(url)` used wherever
the server fetches from a user- or admin-supplied URL (OIDC issuer, optional dashboard
webhooks, admin-provided OIDC config).

Rejected:

- Non-HTTPS schemes (`http://`, `file://`, `gopher://`, `data:`, etc.).
- URLs containing credentials.
- Block-listed hostnames / suffixes (`localhost`, `.internal`, `.local`, cloud
  metadata endpoints, `*.svc`, etc.).
- Resolved IP literals in private / reserved / link-local / loopback ranges (both IPv4 and
  IPv6).
- Hostnames whose origin is not in `OIDC_ISSUER_ALLOWLIST`, when set.

## TLS certificate upload

`apps/server/src/routes/tls.ts` accepts PEM cert + key via multipart.

- Fieldname allow-list: only the literal `cert` and `key` parts are accepted.
- Content is parsed with `node:crypto.X509Certificate` and `createPrivateKey`. Rejections:
  - Invalid or multi-cert PEM that doesn't parse.
  - `notAfter < now` (expired) or `notBefore > now + 24h` (too-future).
  - RSA keys below 2048-bit modulus; EC keys below P-256.
  - MD5/SHA-1 signature algorithms.
  - Public key in cert does not match provided private key.
- Files are written to the configured `TLS_CERT_PATH` / `TLS_KEY_PATH` only after all
  checks pass.

## CSV formula injection

`apps/server/src/lib/circuitBulkImport.ts` escapes every CSV cell that starts with a
formula-triggering character (`= + - @ \t \r`) by prefixing a single apostrophe. This is
the OWASP-recommended pattern for defeating Excel / LibreOffice / Numbers formula
evaluation on imported CSVs.

## Error handling

Fastify's `setErrorHandler` is customized to:

- Log the full error object with `reqId`, URL, and method for any 5xx.
- Return a **generic** `"Internal server error"` body to the client with a `requestId` field
  for support correlation.
- Suppress `error.message`, `error.validation`, and stack traces on 5xx responses in
  production to avoid leaking internal details, DB schema names, or file paths.
- Include a `devMessage` field **only** when `NODE_ENV=development` — preserves fast
  local debugging without affecting production.

## Rate limiting

Global `@fastify/rate-limit`:

- Default: 300 req/min per IP across the API.
- Route-level overrides:
  - `/api/auth/login`: 10 req/min per IP.
  - `/api/setup`: 5 req/min (applies until the first admin exists).
- Per-account login throttle sits in front of bcrypt verification (see Authentication,
  above) so a 5xx-verification attacker cannot brute-force via distinct IPs.

## Dependencies and supply chain

- Lockfiles are committed (`package-lock.json`).
- `npm audit` is expected to be run on the CI pipeline; the `postinstall` hook is a
  local Prisma generate, not a network install.
- `.env`, `*.pem`, `*.key`, and backup files are gitignored by the root `.gitignore`.

## Data at rest

- Credential vault rows: AES-256-GCM (see above).
- Session rows: opaque random IDs (`crypto.randomBytes(32).toString('base64url')`) with
  serialized session data.
- Passwords: bcrypt hashes.
- Provider metric snapshots: unencrypted; consider DB-at-rest encryption at the storage
  layer (pgcrypto / Supabase encryption / filesystem LUKS).

## Logging

- Correlation: each request gets a Fastify `reqId`; server errors include it in the
  response body (`requestId`) for tying back to server logs.
- No request bodies from auth routes are logged.
- Stored credentials are never logged — the vault API returns masked values after save.

## Known gaps / future work

- **Per-account login throttle is in-memory.** A horizontally-scaled deployment would
  share lockout state via the DB or Redis. Acceptable for single-node deployments.
- **No re-encrypt script ships by default.** Rotation today uses the cold-rotation path
  documented in the runbook. A migration script is sketched in the runbook for ops teams
  that need zero downtime.
- **CSP is basic.** Helmet defaults cover most of the dashboard's needs, but a tightened
  CSP (nonce-based script-src, explicit `connect-src` for Meraki/TE/Google Maps) is a
  follow-up item.
- **No WebAuthn / passkey support.** OIDC covers IdP-based MFA; local accounts are still
  password-only. Recommended for single-factor ORG_ADMIN accounts to switch to SSO if your
  IdP supports it.
