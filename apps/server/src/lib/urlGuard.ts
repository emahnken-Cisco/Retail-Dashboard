import { isIP, isIPv4, isIPv6 } from "node:net";

/**
 * Shared defense against SSRF when the server is about to make an outbound HTTP request to
 * a destination that came (directly or indirectly) from user/admin input. The classic attack
 * here is an admin who can change the OIDC issuer URL pointing it at the cloud-provider
 * metadata endpoint (AWS `169.254.169.254`, GCP `metadata.google.internal`) or at an
 * internal service (`http://db:5432`) that's normally firewalled off from the internet —
 * the server dutifully makes the request on their behalf and returns the response.
 *
 * We apply the controls from codeguard's API & Web Services rule: HTTPS only, block private
 * / link-local / loopback / multicast ranges, block known-dangerous hostnames, and — when
 * callers supply an allow-list — require the URL's origin to be on it.
 */

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".internal",
  ".local",
  ".localhost",
  ".localdomain",
  ".metadata.google.internal",
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "ip-ranges.amazonaws.com", // not actually harmful but signals intent
]);

function ipv4ToLong(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) return NaN;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return NaN;
    n = (n << 8) | v;
  }
  // `>>> 0` coerces back to unsigned 32-bit so the shifts above don't produce negatives.
  return n >>> 0;
}

function isPrivateOrReservedIPv4(ip: string): boolean {
  const n = ipv4ToLong(ip);
  if (!Number.isFinite(n)) return true; // malformed → treat as unsafe
  const inRange = (startIp: string, prefix: number): boolean => {
    const base = ipv4ToLong(startIp);
    const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
    return (n & mask) === (base & mask);
  };
  return (
    inRange("0.0.0.0", 8) ||           // "this network"
    inRange("10.0.0.0", 8) ||          // RFC1918 private
    inRange("100.64.0.0", 10) ||       // CGNAT
    inRange("127.0.0.0", 8) ||         // loopback
    inRange("169.254.0.0", 16) ||      // link-local (includes cloud metadata)
    inRange("172.16.0.0", 12) ||       // RFC1918 private
    inRange("192.0.0.0", 24) ||        // IETF protocol assignments
    inRange("192.0.2.0", 24) ||        // TEST-NET-1
    inRange("192.168.0.0", 16) ||      // RFC1918 private
    inRange("198.18.0.0", 15) ||       // network benchmarking
    inRange("198.51.100.0", 24) ||     // TEST-NET-2
    inRange("203.0.113.0", 24) ||      // TEST-NET-3
    inRange("224.0.0.0", 4) ||         // multicast
    inRange("240.0.0.0", 4)            // reserved / broadcast
  );
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;         // ULA
  if (lower.startsWith("ff")) return true;                                   // multicast
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — check the embedded IPv4 too.
    const embedded = lower.slice("::ffff:".length);
    if (isIPv4(embedded)) return isPrivateOrReservedIPv4(embedded);
  }
  return false;
}

export type ExternalUrlCheckOptions = {
  /**
   * Optional exact-origin allow list (scheme + host + port, normalized via URL.origin). When
   * provided, any URL whose origin isn't present is rejected even if it would otherwise pass
   * the private-range checks. Callers building dynamic outbound integrations should pass
   * this whenever they can enumerate the trusted destinations.
   */
  allowList?: readonly string[];
};

export type ExternalUrlCheckResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/**
 * Validate that `raw` is safe for the server to fetch. Only `https:` is accepted by default
 * to prevent downgrade-to-plaintext and to cut the long tail of gopher/file/ftp SSRF tricks.
 */
export function validateExternalHttpsUrl(
  raw: unknown,
  opts: ExternalUrlCheckOptions = {},
): ExternalUrlCheckResult {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, reason: "URL is required" };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "URL is not well-formed" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "URL must use https://" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "URL must not contain credentials" };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { ok: false, reason: "URL has no host" };
  }
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `Hostname ${hostname} is not allowed` };
  }
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (hostname === suffix.slice(1) || hostname.endsWith(suffix)) {
      return { ok: false, reason: `Hostname ${hostname} is not allowed` };
    }
  }

  // Bracketed IPv6 literals come through URL as hostname without brackets.
  const ipKind = isIP(hostname);
  if (ipKind === 4 && isPrivateOrReservedIPv4(hostname)) {
    return { ok: false, reason: "URL resolves to a private or reserved IPv4 range" };
  }
  if (ipKind === 6 && isPrivateOrReservedIPv6(hostname)) {
    return { ok: false, reason: "URL resolves to a private or reserved IPv6 range" };
  }

  if (opts.allowList && opts.allowList.length > 0) {
    if (!opts.allowList.includes(parsed.origin)) {
      return { ok: false, reason: `Origin ${parsed.origin} is not on the allow list` };
    }
  }

  return { ok: true, url: parsed };
}
