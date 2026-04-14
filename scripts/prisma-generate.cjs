/**
 * Run `prisma generate` from the monorepo root (no shell) so paths with spaces work.
 * Loads ../.env when present; uses a dummy DATABASE_URL only for generate (no DB connection).
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
const schema = path.resolve(root, "apps", "server", "prisma", "schema.prisma");

try {
  require("dotenv").config({ path: envPath });
} catch {
  /* optional */
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "postgresql://prisma_generate:prisma_generate@127.0.0.1:5432/prisma_generate?schema=public";
}

if (!fs.existsSync(schema)) {
  console.error("Prisma schema not found:", schema);
  process.exit(1);
}

const prismaEntry = path.join(root, "node_modules", "prisma", "build", "index.js");
if (!fs.existsSync(prismaEntry)) {
  console.error("Prisma CLI not found. Run: npm install");
  console.error("Expected:", prismaEntry);
  process.exit(1);
}

const r = spawnSync(process.execPath, [prismaEntry, "generate", "--schema", schema], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  windowsHide: true,
});

if (r.error) {
  console.error(r.error);
  process.exit(1);
}
process.exit(r.status === null ? 1 : r.status);
