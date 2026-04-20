import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { FastifyError } from "fastify";
import { config } from "../config.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;
/**
 * Fallback salt used when `CREDENTIALS_SALT` is not set in the environment. This string is
 * intentionally stable so existing deployments continue to decrypt rows that were written
 * under the previous (static-salt) version of this module. New installs should always
 * configure `CREDENTIALS_SALT` with an install-specific random value — a per-install salt
 * means that an attacker who obtains a database dump cannot reuse scrypt precomputation
 * work across different "retail-dashboard" installations.
 */
const LEGACY_SALT = "retail-dashboard-v1";
let warnedAboutLegacySalt = false;

function resolveSalt(): string {
  if (config.CREDENTIALS_SALT) {
    return config.CREDENTIALS_SALT;
  }
  if (!warnedAboutLegacySalt) {
    // Log exactly once per process so the operator sees it, but don't spam every call.
    console.warn(
      "cryptoVault: using fallback salt. Set CREDENTIALS_SALT to a unique 16+ character " +
        "value generated with `openssl rand -base64 32` for per-install KDF hardening.",
    );
    warnedAboutLegacySalt = true;
  }
  return LEGACY_SALT;
}

function getKey(): Buffer {
  // A 32-byte base64 value is treated as a raw AES-256 key — the operator has already done
  // the key-generation work and we don't need to run a KDF. Anything else (including base64
  // strings that happen to decode to a different length) is treated as a passphrase and run
  // through scrypt with the configured salt so we still get a 32-byte key.
  const raw = Buffer.from(config.CREDENTIALS_MASTER_KEY, "base64");
  if (raw.length === KEY_LEN) {
    return raw;
  }
  return scryptSync(config.CREDENTIALS_MASTER_KEY, resolveSalt(), KEY_LEN);
}

export function encryptSecret(plain: string): { ciphertext: string; iv: string; authTag: string } {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: 16 });
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptSecret(ciphertextB64: string, ivB64: string, authTagB64: string): string {
  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  const dec = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return dec.toString("utf8");
}

/**
 * Same as {@link decryptSecret}, but turns GCM/auth failures into HTTP 503 with a clear message
 * instead of surfacing as an unhandled 500 (wrong CREDENTIALS_MASTER_KEY or corrupt row).
 */
export function decryptSecretForHttp(ciphertextB64: string, ivB64: string, authTagB64: string, label: string): string {
  try {
    return decryptSecret(ciphertextB64, ivB64, authTagB64);
  } catch {
    const err = new Error(
      `${label} could not be decrypted. Ensure CREDENTIALS_MASTER_KEY matches the key used when this credential was saved.`,
    ) as FastifyError;
    err.statusCode = 503;
    throw err;
  }
}

export function maskLast4(value: string): string {
  const t = value.trim();
  if (t.length <= 4) {
    return "****";
  }
  return `****${t.slice(-4)}`;
}
