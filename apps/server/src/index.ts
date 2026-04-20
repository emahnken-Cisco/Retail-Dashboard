import "./config.js";
import bcrypt from "bcrypt";
import { UserRole } from "@prisma/client";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { getAdminSettings } from "./lib/settings.js";
import { scheduleStartupIngest, startScheduler } from "./jobs/scheduler.js";
import { validatePassword } from "./lib/passwordPolicy.js";

async function bootstrapAdmin(): Promise<void> {
  const bootstrapEmail = config.ADMIN_BOOTSTRAP_EMAIL;
  const bootstrapPassword = config.ADMIN_BOOTSTRAP_PASSWORD;
  if (!bootstrapEmail || !bootstrapPassword) {
    return;
  }

  // Enforce the same password policy we use for normal admin-created accounts. Without this
  // gate, operators could bootstrap their very first account with something trivial and
  // still find themselves locked into a weak password across the lifetime of the install —
  // our UI surfaces no "update admin's own password" path other than the standard one
  // (which would immediately re-enforce the policy anyway). Failing loudly here is much
  // better than silently creating a sub-standard privileged account.
  const pwCheck = validatePassword(bootstrapPassword);
  if (!pwCheck.ok) {
    console.error(
      `Refusing to bootstrap admin: ADMIN_BOOTSTRAP_PASSWORD does not meet password policy (${pwCheck.error}).`,
    );
    process.exit(1);
  }

  const count = await prisma.user.count();
  if (count === 0) {
    // Bug fix: previous code relied on Prisma's default role, which is USER — so the
    // "bootstrap admin" was actually bootstrapped as an unprivileged user and couldn't
    // reach /api/admin/* at all. Explicitly stamp ORG_ADMIN here.
    const passwordHash = await bcrypt.hash(bootstrapPassword, 12);
    await prisma.user.create({
      data: {
        email: bootstrapEmail.toLowerCase(),
        passwordHash,
        role: UserRole.ORG_ADMIN,
      },
    });
    console.log(
      `Bootstrap admin user ${bootstrapEmail.toLowerCase()} created from environment with role ORG_ADMIN.`,
    );
    console.warn(
      "SECURITY: Unset ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD from your env now that bootstrap is complete. " +
        "Keeping a plaintext admin password in the environment or a .env file on disk is a standing credential exposure.",
    );
    return;
  }

  // Users already exist; don't silently ignore — warn once so the operator notices the env
  // vars are now dead weight (and a liability if they ever get checked in).
  console.warn(
    "ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD are set but users already exist. " +
      "These env vars are no longer used; please remove them to avoid leaking a plaintext credential.",
  );
}

async function main(): Promise<void> {
  await bootstrapAdmin();
  await getAdminSettings();

  const app = await buildApp();
  startScheduler();
  scheduleStartupIngest();

  await app.listen({
    host: config.HOST,
    port: config.PORT,
  });

  console.log(`Server listening on ${config.HOST}:${config.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
