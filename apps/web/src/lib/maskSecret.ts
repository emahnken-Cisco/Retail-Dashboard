/**
 * Client-side defense-in-depth mask for the API debug viewer. The server proxy already redacts
 * secrets before they reach the browser; this is a second pass so that even an accidental leak
 * (a new secret format the server misses, or a future direct fetch) is never painted into the DOM.
 *
 * Mirrors the value patterns in the server's secretRedaction.ts. Keep the two in sync.
 */

const REDACTED = "[REDACTED]";

const VALUE_PATTERNS: RegExp[] = [
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /AIza[0-9A-Za-z_-]{35}/g, // Google API key
  /\b(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{10,}/g, // Stripe-style keys
  /\bgh[pousr]_[0-9A-Za-z]{20,}/g, // GitHub tokens
];

/** Mask any known secret value patterns anywhere in a string. */
export function maskSecretText(input: string): string {
  let out = input;
  for (const pattern of VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}
