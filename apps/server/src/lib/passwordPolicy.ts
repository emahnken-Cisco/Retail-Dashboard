import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/**
 * Top passwords observed in real-world credential dumps. Kept inline so the check has zero
 * runtime dependencies and works in air-gapped deployments. Operators who want a richer
 * breach check should front this with HIBP k-anonymity calls (see
 * docs/CONFIGURATION.md → "Password hardening" for the integration pattern).
 */
const COMMON_PASSWORDS = new Set<string>([
  "password",
  "password1",
  "password123",
  "password1234",
  "password12345",
  "passw0rd",
  "p@ssw0rd",
  "p@ssword",
  "p@ssword1",
  "passwordpassword",
  "123456789012",
  "1234567890123",
  "12345678901234",
  "qwertyuiop",
  "qwerty123456",
  "asdfghjkl123",
  "1qaz2wsx3edc",
  "iloveyou123",
  "welcome1234",
  "welcome12345",
  "admin1234567",
  "administrator",
  "letmein1234",
  "letmein12345",
  "abc123456789",
  "monkey123456",
  "dragon123456",
  "sunshine1234",
  "princess1234",
  "football1234",
  "baseball1234",
  "changeme123",
  "changeme1234",
  "qwerty1234567",
  "zaq12wsx3edc",
]);

/**
 * Validate a password against the project's minimum-strength rules. Returns a result instead
 * of throwing so callers can render the reason to the end user without leaking stack traces.
 *
 * Rules (aligned with OWASP ASVS / NIST SP 800-63B guidance):
 *   - Length in [PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]
 *   - No NUL bytes (protects libraries with C-string semantics)
 *   - Not present in the embedded common-password list
 *
 * We intentionally do NOT require character-class composition — modern guidance is to favor
 * length + a breach/common-password check over complexity rules.
 */
export function validatePassword(password: string): { ok: true } | { ok: false; error: string } {
  if (typeof password !== "string") {
    return { ok: false, error: "Password must be a string" };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      error: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
    };
  }
  if (password.includes("\0")) {
    return { ok: false, error: "Password contains invalid characters" };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return {
      ok: false,
      error: "This password is too common; choose something harder to guess",
    };
  }
  return { ok: true };
}

/**
 * Zod schema usable anywhere we accept a password in request bodies. Messages are safe to
 * show to end users — they explain what failed without revealing the full rule set to an
 * attacker (no "password must contain N uppercase" fingerprints).
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .superRefine((val, ctx) => {
    const res = validatePassword(val);
    if (!res.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: res.error });
    }
  });
