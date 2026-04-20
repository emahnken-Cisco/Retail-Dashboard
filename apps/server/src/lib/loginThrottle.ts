/**
 * Per-account login throttle. Complements the per-IP rate limit applied to `/api/auth/login`
 * via @fastify/rate-limit route config: the IP limiter stops a single attacker rotating
 * passwords on one account, while this module stops a distributed attacker (botnet, proxies)
 * rotating IPs against one known account.
 *
 * Implementation is a lazy in-memory map with TTL eviction. It's per-process, which is a
 * known limitation when running multiple replicas — a credential-stuffing attacker with a
 * large botnet could spread their budget across replicas. The fix is to switch to the Prisma
 * session store's approach and persist attempt counters to Postgres; we flag this in the
 * operations docs and leave the upgrade as a follow-up.
 */

const MAX_ATTEMPTS_PER_WINDOW = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_ACCOUNTS = 10_000;

type AttemptRecord = {
  count: number;
  firstAttemptAt: number;
  lockedUntil: number | null;
};

const attempts = new Map<string, AttemptRecord>();

function evictIfOversized(): void {
  if (attempts.size <= MAX_TRACKED_ACCOUNTS) return;
  const now = Date.now();
  for (const [key, rec] of attempts) {
    if (rec.lockedUntil !== null && rec.lockedUntil <= now) {
      attempts.delete(key);
      continue;
    }
    if (now - rec.firstAttemptAt > WINDOW_MS) {
      attempts.delete(key);
    }
  }
  // If we still have too many (attackers spraying many accounts), drop the oldest entries
  // to keep memory bounded. Dropped accounts simply lose their historical count — they'll
  // start fresh if attacked again, which is acceptable since that's slow-roll brute force.
  if (attempts.size > MAX_TRACKED_ACCOUNTS) {
    const ordered = [...attempts.entries()].sort(
      (a, b) => a[1].firstAttemptAt - b[1].firstAttemptAt,
    );
    const overflow = attempts.size - MAX_TRACKED_ACCOUNTS;
    for (let i = 0; i < overflow; i++) {
      attempts.delete(ordered[i][0]);
    }
  }
}

function getOrInit(key: string, now: number): AttemptRecord {
  const existing = attempts.get(key);
  if (!existing) {
    const rec: AttemptRecord = { count: 0, firstAttemptAt: now, lockedUntil: null };
    attempts.set(key, rec);
    evictIfOversized();
    return rec;
  }
  if (existing.lockedUntil !== null && existing.lockedUntil <= now) {
    // lock expired — reset the window
    existing.count = 0;
    existing.firstAttemptAt = now;
    existing.lockedUntil = null;
    return existing;
  }
  if (existing.lockedUntil === null && now - existing.firstAttemptAt > WINDOW_MS) {
    existing.count = 0;
    existing.firstAttemptAt = now;
    return existing;
  }
  return existing;
}

function normalizeKey(identifier: string): string {
  return identifier.trim().toLowerCase();
}

/**
 * Check whether a login attempt for `identifier` (typically a lowercased email) should be
 * allowed. Returns a `retryAfterSec` hint when locked so the caller can include it in the
 * `Retry-After` header.
 */
export function checkLoginAttempt(identifier: string): {
  allowed: true;
} | { allowed: false; retryAfterSec: number } {
  const key = normalizeKey(identifier);
  if (!key) {
    return { allowed: true };
  }
  const now = Date.now();
  const rec = getOrInit(key, now);
  if (rec.lockedUntil !== null && rec.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((rec.lockedUntil - now) / 1000)),
    };
  }
  return { allowed: true };
}

/**
 * Record a failed login for `identifier` and, once the threshold is crossed, lock the account
 * for the remainder of the current window. Idempotent with respect to window bookkeeping.
 */
export function recordFailedLogin(identifier: string): void {
  const key = normalizeKey(identifier);
  if (!key) return;
  const now = Date.now();
  const rec = getOrInit(key, now);
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS_PER_WINDOW) {
    // Lock until the window closes — don't extend past that, so a patient attacker still has
    // to spend real time per attempt and legit users aren't locked out indefinitely.
    rec.lockedUntil = rec.firstAttemptAt + WINDOW_MS;
  }
}

/**
 * Call on successful authentication to wipe the account's failure history. Prevents the "five
 * mistyped attempts then successful login then some minutes later another typo" scenario from
 * tripping the lockout.
 */
export function recordSuccessfulLogin(identifier: string): void {
  const key = normalizeKey(identifier);
  if (!key) return;
  attempts.delete(key);
}

/** Test hook. Not exported in the module's public API. */
export function __resetThrottleForTests(): void {
  attempts.clear();
}
