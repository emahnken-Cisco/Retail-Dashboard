import type { FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";

const SCHEMA_MISMATCH_CODES = new Set(["P2021", "P2022"]);

/**
 * Prisma error code when present. Uses duck-typing so mismatched `@prisma/client` copies
 * (duplicate node_modules) still match — `instanceof PrismaClientKnownRequestError` can fail across copies.
 */
export function getPrismaErrorCode(err: unknown): string | undefined {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code;
  }
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

/**
 * True when the DB is missing a table/column this build expects (migrations not applied).
 */
export function isPrismaSchemaMismatchError(err: unknown): boolean {
  const code = getPrismaErrorCode(err);
  if (code !== undefined && SCHEMA_MISMATCH_CODES.has(code)) {
    return true;
  }
  if (err instanceof Error) {
    const m = err.message;
    if (/relation\s+"CircuitEvent"\s+does not exist/i.test(m)) return true;
    if (/table\s+"CircuitEvent"\s+does not exist/i.test(m)) return true;
  }
  return false;
}

/**
 * When the DB was not migrated after a Prisma schema change, queries throw P2021/P2022.
 * Respond with a clear message instead of a generic 500.
 *
 * @returns true if a response was sent
 */
export function replyIfPrismaSchemaMismatch(
  err: unknown,
  reply: FastifyReply,
  log: { warn: (o: Record<string, unknown>, msg: string) => void },
): boolean {
  if (!isPrismaSchemaMismatchError(err)) {
    return false;
  }
  const code = getPrismaErrorCode(err) ?? "schema_mismatch";
  log.warn({ err, prismaCode: code }, "database schema mismatch (run migrations)");
  void reply.code(503).send({
    error: "Database schema is out of date for this server version.",
    code,
    hint: "From the project root run: npm run db:migrate (or npx prisma migrate deploy with DATABASE_URL set), then restart the server.",
  });
  return true;
}
