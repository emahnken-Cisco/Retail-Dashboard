import { config as dotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv({ path: resolve(__dirname, "../../../.env") });
dotenv({ path: resolve(__dirname, "../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  /**
   * Master key for AES-256-GCM encryption of credential vault rows. Must be at least
   * 32 characters to keep the scrypt-derived KEK resistant to offline guessing if the
   * database is ever leaked. Either a 32-byte base64 value OR a ≥32-char passphrase works;
   * the key derivation path depends on length, see `cryptoVault.ts`. Rotating this value
   * invalidates every stored credential — plan a re-encrypt migration before rotating.
   */
  CREDENTIALS_MASTER_KEY: z.string().min(32, {
    message:
      "CREDENTIALS_MASTER_KEY must be at least 32 characters. Generate one with: " +
      `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` +
      " — note: rotating this key invalidates every row in CredentialVault, so you'll " +
      "need to re-enter stored provider credentials (Meraki API key, etc.) in the admin UI.",
  }),
  /**
   * Per-install salt for the scrypt KDF over CREDENTIALS_MASTER_KEY. Optional: when unset,
   * the code uses a documented fallback salt so existing deployments keep decrypting their
   * vault rows. Setting a fresh random value here is strongly recommended on new installs
   * (it stops an attacker who gets one database dump from using precomputed rainbow tables
   * shared across all "retail-dashboard" installations). Must be ≥16 chars. Rotating this
   * has the same implication as rotating the master key: existing rows cannot be decrypted.
   */
  CREDENTIALS_SALT: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    z.string().min(16).optional(),
  ),
  SESSION_SECRET: z.string().min(32),
  PUBLIC_URL: z.string().url().default("http://localhost:3001"),
  HTTPS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  TLS_CERT_PATH: z.string().optional(),
  TLS_KEY_PATH: z.string().optional(),
  OIDC_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  OIDC_ISSUER_URL: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    z.string().url().optional(),
  ),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_CALLBACK_PATH: z.string().default("/api/auth/oidc/callback"),
  /**
   * Comma-separated list of exact origins (scheme + host + port) that are permitted as the
   * OIDC issuer. When set, the server refuses any admin-supplied `oidcIssuerUrl` whose
   * origin isn't on the list — a pure defense-in-depth hardening for the SSRF class where a
   * compromised ORG_ADMIN points the issuer at an internal service. Leave unset to allow
   * any public HTTPS issuer (the built-in private-range check still applies).
   */
  OIDC_ISSUER_ALLOWLIST: z.string().optional(),
  ADMIN_BOOTSTRAP_EMAIL: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
    z.string().email().optional(),
  ),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().optional(),
  /**
   * Comma-separated list of additional origins allowed for cross-origin browser requests
   * (beyond PUBLIC_URL and FRONTEND_URL). Use for staging / preview deploys. Never set to "*"
   * — the CORS + Origin-guard layer rejects that combination explicitly.
   */
  ALLOWED_ORIGINS: z.string().optional(),
  /**
   * When set to "true", Fastify treats `X-Forwarded-*` headers from the reverse proxy as
   * authoritative for req.ip and req.protocol. Required for correct rate limiting, secure
   * cookie detection, and logging when deployed behind NGINX / ALB / Cloudflare.
   */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (!v) continue;
    try {
      out.push(new URL(v).origin);
    } catch {
      console.warn(`Ignoring invalid ALLOWED_ORIGINS entry: ${v}`);
    }
  }
  return out;
}

function computeOriginAllowList(data: z.infer<typeof envSchema>): string[] {
  const set = new Set<string>();
  try {
    set.add(new URL(data.PUBLIC_URL).origin);
  } catch {
    // PUBLIC_URL is validated as url() above; this shouldn't happen
  }
  const front = process.env.FRONTEND_URL;
  if (front && front.trim()) {
    try {
      set.add(new URL(front.trim()).origin);
    } catch {
      console.warn(`Ignoring invalid FRONTEND_URL: ${front}`);
    }
  }
  for (const o of parseAllowedOrigins(data.ALLOWED_ORIGINS)) {
    set.add(o);
  }
  return [...set];
}

function computeOidcIssuerAllowList(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (!v) continue;
    try {
      out.push(new URL(v).origin);
    } catch {
      console.warn(`Ignoring invalid OIDC_ISSUER_ALLOWLIST entry: ${v}`);
    }
  }
  return out;
}

export const config = {
  ...parsed.data,
  HTTPS_ENABLED: parsed.data.HTTPS_ENABLED ?? false,
  OIDC_ENABLED: parsed.data.OIDC_ENABLED ?? false,
  TRUST_PROXY: parsed.data.TRUST_PROXY ?? false,
  TLS_CERT_PATH: parsed.data.TLS_CERT_PATH || undefined,
  TLS_KEY_PATH: parsed.data.TLS_KEY_PATH || undefined,
  OIDC_ISSUER_URL: parsed.data.OIDC_ISSUER_URL || undefined,
  OIDC_CLIENT_ID: parsed.data.OIDC_CLIENT_ID || undefined,
  OIDC_CLIENT_SECRET: parsed.data.OIDC_CLIENT_SECRET || undefined,
  CREDENTIALS_SALT: parsed.data.CREDENTIALS_SALT || undefined,
  /**
   * Origins allowed to make authenticated cross-origin browser requests. Built from PUBLIC_URL,
   * FRONTEND_URL, and ALLOWED_ORIGINS. Used by CORS and the Origin-guard CSRF layer.
   */
  ORIGIN_ALLOW_LIST: computeOriginAllowList(parsed.data),
  /**
   * Optional allow-list of issuer origins used by the OIDC login route. Empty = no
   * origin-level restriction (but private-range / scheme checks still apply).
   */
  OIDC_ISSUER_ALLOW_LIST: computeOidcIssuerAllowList(parsed.data.OIDC_ISSUER_ALLOWLIST),
};

export type AppConfig = typeof config;
