import { X509Certificate, createPrivateKey, createPublicKey } from "node:crypto";

const MAX_PEM_BYTES = 64 * 1024;

const CERT_PEM_RE = /^-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----\s*$/;
const KEY_PEM_RE =
  /^-----BEGIN (?:RSA |EC |DSA |ENCRYPTED |)PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |DSA |ENCRYPTED |)PRIVATE KEY-----\s*$/;

export type PemValidationResult =
  | { ok: true; cert: X509Certificate }
  | { ok: false; error: string };

/**
 * Validate that an uploaded cert+key pair is syntactically a PEM-encoded X.509 certificate
 * and a matching PEM-encoded private key. Rejects pre-expired / not-yet-valid certificates
 * and mismatched key pairs. This is the server-side gate before we ever write the files to
 * disk — without it, an ORG_ADMIN with hijacked credentials could upload arbitrary content
 * that's later served as site TLS material or read by any code paths that parse it.
 *
 * The `now` parameter is injectable only to keep unit tests deterministic; production paths
 * must omit it so the current wall-clock time is used.
 */
export function validateTlsPemPair(
  certPem: string,
  keyPem: string,
  now: Date = new Date(),
): PemValidationResult {
  if (typeof certPem !== "string" || typeof keyPem !== "string") {
    return { ok: false, error: "Certificate and key must be PEM text" };
  }
  if (certPem.length === 0 || keyPem.length === 0) {
    return { ok: false, error: "Certificate and key must not be empty" };
  }
  if (certPem.length > MAX_PEM_BYTES || keyPem.length > MAX_PEM_BYTES) {
    return { ok: false, error: "Certificate or key exceeds maximum size" };
  }
  if (certPem.includes("\0") || keyPem.includes("\0")) {
    return { ok: false, error: "Certificate or key contains invalid bytes" };
  }
  // Normalize line endings so an uploader-specific CRLF vs LF mismatch doesn't trip the
  // structural regex; Node's PEM parsers accept either but our quick shape check is stricter.
  const certNorm = certPem.trim().replace(/\r\n/g, "\n");
  const keyNorm = keyPem.trim().replace(/\r\n/g, "\n");
  if (!CERT_PEM_RE.test(certNorm)) {
    return {
      ok: false,
      error:
        "Certificate file is not PEM-encoded (expected -----BEGIN CERTIFICATE----- / -----END CERTIFICATE-----)",
    };
  }
  if (!KEY_PEM_RE.test(keyNorm)) {
    return {
      ok: false,
      error:
        "Private key file is not PEM-encoded (expected -----BEGIN PRIVATE KEY----- or similar)",
    };
  }

  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certNorm);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unable to parse certificate";
    return { ok: false, error: `Invalid certificate: ${msg}` };
  }

  let keyObj: ReturnType<typeof createPrivateKey>;
  try {
    keyObj = createPrivateKey(keyNorm);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unable to parse private key";
    return { ok: false, error: `Invalid private key: ${msg}` };
  }

  const notBefore = new Date(cert.validFrom);
  const notAfter = new Date(cert.validTo);
  if (Number.isNaN(notBefore.getTime()) || Number.isNaN(notAfter.getTime())) {
    return { ok: false, error: "Certificate validity window is unreadable" };
  }
  if (now < notBefore) {
    return {
      ok: false,
      error: `Certificate is not yet valid (starts ${notBefore.toISOString()})`,
    };
  }
  if (now > notAfter) {
    return {
      ok: false,
      error: `Certificate is expired (ended ${notAfter.toISOString()})`,
    };
  }

  // Cheapest reliable key-pair match: derive the public key from the private key and
  // compare its SPKI DER bytes to the certificate's SPKI DER bytes. If they differ, the
  // uploader supplied a key that does not belong to this certificate — serving that pair
  // would cause TLS handshakes to fail and could indicate an attempted credential swap.
  const certPubSpki = createPublicKey(cert.publicKey).export({
    type: "spki",
    format: "der",
  });
  const keyPubSpki = createPublicKey(keyObj).export({ type: "spki", format: "der" });
  if (!certPubSpki.equals(keyPubSpki)) {
    return {
      ok: false,
      error: "Private key does not match the certificate's public key",
    };
  }

  return { ok: true, cert };
}
