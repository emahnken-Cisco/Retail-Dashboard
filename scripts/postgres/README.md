# PostgreSQL setup

## Why two SQL files?

SQL clients such as **pgAdmin**, **DBeaver**, and **Azure Data Studio** execute **standard SQL only**. They do **not** understand **psql** meta-commands like `\set` or `\c`, which produce `syntax error at or near "\"`.

Use:

1. **[`01-create-role-and-database.sql`](./01-create-role-and-database.sql)** — run while connected to the **`postgres`** database (superuser).
2. **[`02-grants-in-retail-dashboard.sql`](./02-grants-in-retail-dashboard.sql)** — run while connected to **`retail_dashboard`** (new connection / query window targeted at that database).

Replace `REPLACE_WITH_STRONG_PASSWORD` in file **01** before the first run.

## `psql` (command line)

```bash
psql -U postgres -h 127.0.0.1 -f scripts/postgres/01-create-role-and-database.sql
psql -U postgres -h 127.0.0.1 -d retail_dashboard -f scripts/postgres/02-grants-in-retail-dashboard.sql
```

## If grants ran on the wrong database

If part **02** was executed while still connected to **`postgres`**, the `public` schema that was updated was **not** the one inside `retail_dashboard`. Fix: connect to **`retail_dashboard`** and run **`02-grants-in-retail-dashboard.sql`** again.

## `DATABASE_URL`

```text
postgresql://retail_dashboard_app:YOUR_PASSWORD@HOST:5432/retail_dashboard?schema=public
```

## Docker Compose in this repo

`docker-compose.yml` uses user `retail` for local dev. These scripts target a dedicated production-style role `retail_dashboard_app`.

## Supabase

Usually you use the connection string from the Supabase dashboard instead of this script.

## Something fails after creating the database?

See **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** (wrong DB for part 2, superuser, URL-encoded password, SSL).

After grants, optionally run **[verify-connection.sql](./verify-connection.sql)** while logged in as `retail_dashboard_app`.
