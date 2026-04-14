import "./config.js";
import bcrypt from "bcrypt";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { getAdminSettings } from "./lib/settings.js";
import { scheduleStartupIngest, startScheduler } from "./jobs/scheduler.js";

async function bootstrapAdmin(): Promise<void> {
  const count = await prisma.user.count();
  if (
    count === 0 &&
    config.ADMIN_BOOTSTRAP_EMAIL &&
    config.ADMIN_BOOTSTRAP_PASSWORD
  ) {
    const passwordHash = await bcrypt.hash(config.ADMIN_BOOTSTRAP_PASSWORD, 12);
    await prisma.user.create({
      data: {
        email: config.ADMIN_BOOTSTRAP_EMAIL.toLowerCase(),
        passwordHash,
      },
    });
    console.log("Bootstrap admin user created from environment.");
  }
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
