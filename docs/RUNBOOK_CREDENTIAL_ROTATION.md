# Runbook: Rotating `CREDENTIALS_MASTER_KEY` (and `CREDENTIALS_SALT`)

Applies to versions **1.1.0 and later**.

This runbook covers rotating the credential-vault encryption key used to protect stored
provider secrets (Meraki API key, ThousandEyes bearer token, OpenWeather key, OIDC client
secret, Google Maps JavaScript API key). It also applies to rotating `CREDENTIALS_SALT`.

## TL;DR

- Rotating `CREDENTIALS_MASTER_KEY` or `CREDENTIALS_SALT` will make **every row in the
  `CredentialVault` table un-decryptable under the new key/salt pair**.
- Rotation is safe in either of two modes:
  - **Cold rotation** (simplest) — take a maintenance window, delete vault rows, deploy the
    new key, re-enter credentials in the admin UI.
  - **Re-encrypt migration** (zero user impact) — decrypt every row with the old key, encrypt
    with the new key, swap env vars atomically.
- Always rotate **both** values together the first time a deployment moves from the legacy
  fallback salt to a per-install salt.

## When to rotate

Rotate on any of the following signals:

1. The current `CREDENTIALS_MASTER_KEY` was ever the template placeholder
   `REPLACE_WITH_BASE64_32_BYTES`, or any other value shorter than 32 characters (pre-1.1.0
   installs most commonly hit this).
2. The current `CREDENTIALS_SALT` is unset, and the server log shows
   `cryptoVault: using fallback salt` at boot. The fallback is documented and stable, but
   shared across every install of this app — rotating to a per-install salt closes that
   pre-computation risk.
3. Suspected exposure of the key material (leaked `.env`, shared `.env.bak`, a former admin
   who still has a backup, laptop loss, etc.).
4. Scheduled rotation cadence (annually is a reasonable baseline).
5. You are moving `CREDENTIALS_MASTER_KEY` from a short passphrase to a random 32-byte base64
   value — recommended for all production installs.

## Preconditions

- You have shell access to the host that reads `.env`.
- You have `psql` or another client able to run SQL against the app DB.
- You have the original source credentials (Meraki API key, etc.) available to re-enter —
  required only for cold rotation.
- The app is at version **1.1.0 or later**. Older versions neither enforce the min-length on
  `CREDENTIALS_MASTER_KEY` nor read `CREDENTIALS_SALT`.

## Option A — Cold rotation (maintenance window, ≤ 10 min)

Use this when:
- You have a short list of provider credentials and can re-enter them quickly.
- You are rotating because the old value was a known placeholder / known-weak and you
  consider the previously-encrypted rows already burned.
- You have not yet deployed a re-encrypt migration script.

### Steps

1. **Announce a maintenance window** — ingest will skip with `error` while credentials are
   empty.

2. **Generate the new key and salt** in your own local terminal (never paste into chat or
   logs). Run each line separately and capture two different values:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   On Linux/macOS `openssl rand -base64 32` also works for each value.

3. **Stop the application.** systemd:

   ```bash
   sudo systemctl stop retail-dashboard
   ```

   Dev:

   ```powershell
   # Ctrl-C in the npm run dev terminal
   ```

4. **Back up the current vault rows** so you can identify what needs re-entering:

   ```sql
   CREATE TABLE "CredentialVault_preRotation_YYYYMMDD" AS
     SELECT * FROM "CredentialVault";

   SELECT provider FROM "CredentialVault";
   ```

   Keep this backup table for at least 30 days in case you need to audit what was stored.

5. **Delete the rows that will become un-decryptable:**

   ```sql
   DELETE FROM "CredentialVault";
   ```

6. **Invalidate all active sessions** — the cookie store is unaffected, but forcing a fresh
   login catches anyone whose session data references an old config:

   ```sql
   DELETE FROM "Session";
   ```

7. **Update `.env`** at the repo root (or `apps/server/.env` if that's where your
   deployment loads from). Replace both lines:

   ```
   CREDENTIALS_MASTER_KEY="<first-value-from-step-2>"
   CREDENTIALS_SALT="<second-value-from-step-2>"
   ```

   Double-check file permissions: `chmod 600 .env` on Linux; check that it is not tracked
   in git (`git ls-files --error-unmatch .env` should return a non-zero exit code).

8. **Start the application** and watch the log:

   ```bash
   sudo systemctl start retail-dashboard
   journalctl -u retail-dashboard -f
   ```

   You should **not** see `cryptoVault: using fallback salt` anymore. You should not see
   `Invalid environment:` errors.

9. **Re-enter provider credentials** in the admin UI:
   - **Admin → API keys**: Meraki Dashboard API key, ThousandEyes bearer token,
     OpenWeather key, Google Maps JavaScript API key.
   - **Admin → Settings** (OIDC section): OIDC client secret, if used.
   - Use **Test connection** on each where available.

10. **Verify ingest resumes**: **Admin → Recent ingest** — next scheduled run should
    succeed instead of skipping with an error about missing credentials.

11. **Close the maintenance window** and announce the rotation complete.

## Option B — Re-encrypt migration (zero downtime for end-users)

Use this when:
- You cannot easily re-enter credentials (e.g. a shared Meraki key rotated out of your reach).
- You want to rotate on a regular cadence without invalidating the vault.

> **Note**: This app does not ship a pre-built re-encrypt script as of 1.1.0. The outline
> below is the reference design; build it as a one-off script under
> `apps/server/src/scripts/` for your next scheduled rotation.

### Design

```
OLD_KEY + OLD_SALT  →  DEK_OLD  (scrypt-derived)
NEW_KEY + NEW_SALT  →  DEK_NEW  (scrypt-derived)

for each row r in CredentialVault:
    plaintext = AES-256-GCM decrypt(r.payload, DEK_OLD)
    r.payload = AES-256-GCM encrypt(plaintext, DEK_NEW)
    UPDATE CredentialVault SET payload = r.payload WHERE id = r.id
```

### Concrete steps

1. Keep the app **running** on the old key.
2. In `.env`, add (don't replace) a second key:

   ```
   CREDENTIALS_MASTER_KEY="<old-value-unchanged>"
   CREDENTIALS_SALT="<old-value-unchanged>"
   CREDENTIALS_MASTER_KEY_NEXT="<new-value>"
   CREDENTIALS_SALT_NEXT="<new-value>"
   ```

3. Write a one-off script in `apps/server/src/scripts/reencryptVault.ts` that:
   - Reads both key pairs via a patched `cryptoVault` that accepts explicit key/salt.
   - Iterates `prisma.credentialVault.findMany({})`.
   - Decrypts each `payload` with the old pair, re-encrypts with the new pair.
   - Wraps the update in a transaction with a row-level advisory lock so a concurrent ingest
     cannot read a half-written row.
   - Writes to a temporary column first (e.g. `payload_next`), verifies, then swaps. A single
     failed row aborts the migration.

4. Run the script against a staging copy first:

   ```bash
   npx tsx apps/server/src/scripts/reencryptVault.ts --dry-run
   npx tsx apps/server/src/scripts/reencryptVault.ts --commit
   ```

5. Once the script reports 0 errors, swap the env vars:

   ```
   CREDENTIALS_MASTER_KEY="<was-CREDENTIALS_MASTER_KEY_NEXT>"
   CREDENTIALS_SALT="<was-CREDENTIALS_SALT_NEXT>"
   # delete the _NEXT lines
   ```

6. **Restart** the app. Users experience only a brief downtime during restart.

7. **Shred the old key material**: overwrite any `.env.bak`, rotate any password-manager
   entry, and document the rotation date in your operations log.

## Rollback

### Cold rotation rollback

- If you still have the backup table (`CredentialVault_preRotation_YYYYMMDD`), restore
  rows **and** the old `CREDENTIALS_MASTER_KEY` / `CREDENTIALS_SALT` values together. They
  must match — the backup is useless under the new key.

### Re-encrypt migration rollback

- Abort between steps 3 and 5 by simply deleting the `_NEXT` env vars and restarting. The
  live rows are untouched.
- Abort after step 5 by re-running the migration in the opposite direction (swap old ↔
  new in the script).

## Verification checklist

After any rotation, confirm:

- [ ] `npm run dev` or production start emits no `Invalid environment:` lines.
- [ ] Server log has no `cryptoVault: using fallback salt` warning.
- [ ] `SELECT COUNT(*) FROM "CredentialVault";` is non-zero (cold rotation: matches the
      number of credentials you re-entered).
- [ ] **Admin → API keys** → **Test connection** succeeds for each provider.
- [ ] **Admin → Recent ingest** shows a non-skipped run since the rotation.
- [ ] `.env` is not tracked: `git ls-files --error-unmatch .env` exits non-zero.
- [ ] `.env` permissions are `600` (Linux/macOS).

## Common mistakes

- **Using an insecurely generated value** — e.g. a memorable string or a short passphrase.
  The Zod check enforces a 32-char minimum, but weak structure is still vulnerable to
  offline guessing. Always use `crypto.randomBytes(32).toString('base64')`.
- **Pasting the key into chat, a pull request, or a terminal that logs to a shared file.**
  Any transcript-like surface should be considered a disclosure. If it lands there, the key
  is burned — rotate again.
- **Forgetting to update both `CREDENTIALS_MASTER_KEY` and `CREDENTIALS_SALT`** — they are
  independent secrets and both need to be fresh random values on a new install. A per-install
  salt with a shared master key is weaker than both being fresh.
- **Trying to rotate keys live by editing `.env` without stopping the app** — the config is
  read once at boot, so edits don't take effect until restart. Worse, a partial write to
  `.env` at the same moment Node re-reads the file (it doesn't, but tools like editors with
  autosave can race) could corrupt the file.

## Related

- [Security overview](./SECURITY.md) — full list of hardening layers.
- [Configuration reference](./CONFIGURATION.md) — all environment variables.
- `apps/server/src/lib/cryptoVault.ts` — implementation (scrypt KDF + AES-256-GCM).
