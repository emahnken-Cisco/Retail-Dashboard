/**
 * Centralized secret redaction for anything that could be shown back to a browser (notably the
 * API debug viewer). The goal is that a real API key / token / password is never serialized into
 * an HTTP response that a user can read. Two layers:
 *   1. Key-name based: object keys that look like secrets have their values masked regardless of
 *      the value shape (`{ apiKey: "AIza..." }` -> `{ apiKey: "****...." }`).
 *   2. Value-pattern based: known secret formats are masked anywhere they appear in a string,
 *      including free-form text bodies with no JSON structure.
 *
 * Recursion is bounded (depth + total node count) so a hostile / pathological payload cannot be
 * used to exhaust the event loop while being redacted.
 */
import { maskLast4 } from "./cryptoVault.js";

const REDACTED = "[REDACTED]";
const TRUNCATED = "[REDACTED:truncated]";

/** Bound recursion so a deeply nested / huge payload can't DoS the redactor. */
const MAX_DEPTH = 16;
const MAX_NODES = 50_000;

/**
 * Object keys (normalized to lowercase alphanumerics) whose values are always treated as secrets.
 * Normalization means `apiKey`, `api_key`, `API-KEY` all collapse to `apikey`.
 */
const SECRET_KEY_NAMES = new Set<string>([
  "apikey",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "authorization",
  "password",
  "passwd",
  "bearer",
  "privatekey",
]);

/**
 * Known secret value formats. Each is masked wherever it appears in a string. Ordered roughly by
 * specificity; PEM blocks first so we collapse the whole block before other rules can nibble it.
 */
const VALUE_PATTERNS: RegExp[] = [
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT (header.payload.signature)
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi, // Authorization: Bearer <token>
  /AIza[0-9A-Za-z_-]{35}/g, // Google API key
  /\b(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{10,}/g, // Stripe-style keys
  /\bgh[pousr]_[0-9A-Za-z]{20,}/g, // GitHub tokens
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_NAMES.has(normalizeKey(key));
}

/** Mask a value that lives under a secret-looking key. Shows only the last 4 for strings. */
function maskSecretValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length === 0 ? value : maskLast4(value);
  }
  if (value == null) {
    return value;
  }
  return REDACTED;
}

/**
 * Mask known secret value patterns anywhere in a free-form string. Safe for JSON strings and for
 * non-JSON response bodies alike.
 */
export function redactText(input: string): string {
  let out = input;
  for (const pattern of VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/**
 * Deep-redact an arbitrary JSON-like value. Strings are pattern-scrubbed; values under
 * secret-looking keys are masked to last-4. Returns a new structure; the input is not mutated.
 */
export function redactJson(value: unknown): unknown {
  let nodes = 0;

  function walk(node: unknown, depth: number): unknown {
    nodes += 1;
    if (depth > MAX_DEPTH || nodes > MAX_NODES) {
      return TRUNCATED;
    }
    if (typeof node === "string") {
      return redactText(node);
    }
    if (Array.isArray(node)) {
      return node.map((item) => walk(item, depth + 1));
    }
    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        out[key] = isSecretKey(key) ? maskSecretValue(val) : walk(val, depth + 1);
      }
      return out;
    }
    return node;
  }

  return walk(value, 0);
}
