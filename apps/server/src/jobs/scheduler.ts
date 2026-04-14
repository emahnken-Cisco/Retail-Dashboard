import cron from "node-cron";
import { runMerakiIngest } from "./merakiIngest.js";
import { runThousandEyesIngest } from "./thousandEyesIngest.js";
import { runRetentionPurge } from "./retention.js";
import { getAdminSettings } from "../lib/settings.js";

let lastMeraki = 0;
let lastTe = 0;

/** Run once shortly after boot so the dashboard is not empty until the first cron tick (up to 1 min). */
export function scheduleStartupIngest(delayMs = 4000): void {
  setTimeout(() => {
    void (async () => {
      await runMerakiIngest();
      lastMeraki = Date.now();
      await runThousandEyesIngest();
      lastTe = Date.now();
    })();
  }, delayMs);
}

export function startScheduler(): void {
  cron.schedule("* * * * *", async () => {
    try {
      const s = await getAdminSettings();
      const now = Date.now();
      if (now - lastMeraki >= s.pollIntervalMerakiSec * 1000) {
        lastMeraki = now;
        await runMerakiIngest();
      }
      if (now - lastTe >= s.pollIntervalTESec * 1000) {
        lastTe = now;
        await runThousandEyesIngest();
      }
    } catch {
      /* logged in jobs */
    }
  });

  cron.schedule("5 3 * * *", async () => {
    try {
      await runRetentionPurge();
    } catch {
      /* ignore */
    }
  });
}
