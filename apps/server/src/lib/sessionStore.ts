import type { Session } from "fastify";
import { prisma } from "./prisma.js";

// @fastify/session exports its types as a namespace via `export =`, which trips up named
// `import type` under NodeNext. We model the SessionStore contract directly to keep this
// store decoupled from that quirk.
type SessionCallback = (err?: unknown) => void;
type SessionGetCallback = (err: unknown, result?: Session | null) => void;

interface SessionStore {
  set(sessionId: string, session: Session, callback: SessionCallback): void;
  get(sessionId: string, callback: SessionGetCallback): void;
  destroy(sessionId: string, callback: SessionCallback): void;
}

/**
 * Persistent session store backed by the Prisma `Session` table. Replaces the default
 * in-memory store so sessions survive process restarts, work across horizontally scaled
 * instances, and can be invalidated centrally (e.g. on logout or admin-forced revocation).
 *
 * Contract matches @fastify/session v11's SessionStore interface: callback-style
 * (err, result?) with no return values. Session payloads are stored JSON-encoded.
 */

type SessionWithCookie = {
  cookie?: {
    expires?: Date | string | null;
    originalMaxAge?: number | null;
  };
};

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

function resolveExpiresAt(session: unknown): Date {
  const s = session as SessionWithCookie;
  const raw = s?.cookie?.expires;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  const originalMaxAge = s?.cookie?.originalMaxAge;
  if (typeof originalMaxAge === "number" && Number.isFinite(originalMaxAge) && originalMaxAge > 0) {
    return new Date(Date.now() + originalMaxAge);
  }
  return new Date(Date.now() + DEFAULT_TTL_MS);
}

export const prismaSessionStore: SessionStore = {
  set(sessionId, session, callback) {
    let data: string;
    try {
      data = JSON.stringify(session);
    } catch (err) {
      callback(err as Error);
      return;
    }
    const expiresAt = resolveExpiresAt(session);
    prisma.session
      .upsert({
        where: { id: sessionId },
        create: { id: sessionId, data, expiresAt },
        update: { data, expiresAt },
      })
      .then(() => callback())
      .catch((err) => callback(err as Error));
  },

  get(sessionId, callback) {
    prisma.session
      .findUnique({ where: { id: sessionId } })
      .then((row) => {
        if (!row) {
          callback(null, null);
          return;
        }
        if (row.expiresAt.getTime() <= Date.now()) {
          prisma.session
            .delete({ where: { id: sessionId } })
            .catch(() => {
              // best-effort cleanup; ignore errors (e.g. already deleted)
            });
          callback(null, null);
          return;
        }
        try {
          const parsed = JSON.parse(row.data) as Session;
          callback(null, parsed);
        } catch (err) {
          callback(err as Error);
        }
      })
      .catch((err) => callback(err as Error));
  },

  destroy(sessionId, callback) {
    prisma.session
      .delete({ where: { id: sessionId } })
      .then(() => callback())
      .catch((err) => {
        const code = (err as { code?: unknown } | null)?.code;
        if (code === "P2025") {
          // Row already gone — treat as success so logout is idempotent.
          callback();
          return;
        }
        callback(err as Error);
      });
  },
};

/**
 * Delete expired session rows. Safe to call on a timer; no-op when nothing is expired.
 */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return result.count;
}
