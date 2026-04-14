# PostgreSQL setup troubleshooting

## 1. “The rest of the commands are not working”

Usually one of these:

### A) Part 2 was not run on `retail_dashboard`

Grants apply to **`public` inside the database you are connected to**.

- **Wrong:** Query tool says database **`postgres`** → `GRANT ... ON SCHEMA public` changes **`postgres.public`**, not `retail_dashboard.public`.
- **Right:** Open a new query / connection whose **database** is **`retail_dashboard`**, then run [`02-grants-in-retail-dashboard.sql`](./02-grants-in-retail-dashboard.sql).

**Check:** In pgAdmin, the window title often shows the DB name. In DBeaver, use the database dropdown in the SQL editor.

### B) Part 2 was not run as a superuser

`GRANT` on schema/tables needs a privileged user (typically **`postgres`** or an admin role).

If you see **permission denied** on `GRANT`, log in as **`postgres`** (or your cloud “admin” user), connect to **`retail_dashboard`**, and run part 2 again.

### C) App / Prisma: `DATABASE_URL` is wrong

- Host, port, database name must match (`retail_dashboard`).
- User: `retail_dashboard_app`.
- **Special characters in the password** (`@`, `#`, `!`, `%`, spaces, etc.) must be **URL-encoded** in `DATABASE_URL`.

Examples:

| Character | In URL use |
|-----------|------------|
| `@` | `%40` |
| `#` | `%23` |
| `!` | `%21` |
| `%` | `%25` |
| space | `%20` |

Example (password is `p@ss!word`):

```text
postgresql://retail_dashboard_app:p%40ss%21word@localhost:5432/retail_dashboard?schema=public
```

In **Node** you can build it safely:

```js
const u = new URL('postgresql://localhost/retail_dashboard');
u.username = 'retail_dashboard_app';
u.password = 'your raw password';
u.searchParams.set('schema', 'public');
console.log(u.toString());
```

Put that string in `.env` as `DATABASE_URL`.

### D) SSL required (common on Azure / AWS / managed Postgres)

Add to the URL (try in this order):

```text
?schema=public&sslmode=require
```

or

```text
?schema=public&sslmode=no-verify
```

(Use `require` when you have proper CA trust; avoid `no-verify` in production if possible.)

---

## 2. Verify the database user (quick checks)

As **`retail_dashboard_app`**, connected to **`retail_dashboard`**, run [`verify-connection.sql`](./verify-connection.sql).

You want `public_usage` and `public_create` both **true**.

From the shell:

```bash
psql "postgresql://retail_dashboard_app:ENCODED_PASSWORD@HOST:5432/retail_dashboard" -f scripts/postgres/verify-connection.sql
```

---

## 3. Prisma migrate errors

Run from the **repo root** with `.env` present:

```bash
npm run db:migrate
```

- **`P1001` / connection refused:** Postgres not running, wrong host/port, or firewall.
- **`P1000` / authentication failed:** Wrong user/password or password not URL-encoded.
- **Permission denied for schema public:** Part 2 not applied on `retail_dashboard`, or migrate was run as a different user and objects are owned by `postgres`. Fix: run part 2 as superuser on `retail_dashboard`, then either re-run migrate as `retail_dashboard_app` or ask a DBA to `REASSIGN OWNED` for the Prisma tables (advanced).

---

## 4. “Database already exists” when re-running part 1

That is normal. You only need part 1 once. If the role exists too, the script skips creating the role. Skip to part 2 on **`retail_dashboard`** if grants were never applied correctly.

---

## 5. Still stuck

Copy the **exact error message** (SQL error or Prisma output). The first line usually indicates which of the sections above applies.
