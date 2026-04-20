import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import {
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  randomPKCECodeVerifier,
  calculatePKCECodeChallenge,
  ClientSecretPost,
} from "openid-client";
import { config } from "../config.js";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getAdminSettings } from "../lib/settings.js";
import { validateExternalHttpsUrl } from "../lib/urlGuard.js";

/**
 * Validate the issuer URL before handing it to `discovery()`. An ORG_ADMIN can set
 * `oidcIssuerUrl` to any string from the admin UI, which — without this gate — is a direct
 * SSRF primitive: the server fetches `<issuer>/.well-known/openid-configuration` and we'd
 * happily follow a URL pointing at AWS metadata (`169.254.169.254`), an internal service,
 * or a non-HTTPS endpoint. The guard enforces HTTPS, blocks private/link-local/loopback
 * ranges and the classic ".internal" / ".local" suffixes, and — if the operator supplied
 * `OIDC_ISSUER_ALLOWLIST` — restricts the origin to that list.
 */
function validateIssuerUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  const check = validateExternalHttpsUrl(raw, {
    allowList: config.OIDC_ISSUER_ALLOW_LIST,
  });
  if (!check.ok) {
    return check;
  }
  return { ok: true, url: check.url };
}

function callbackUri(): string {
  const base = config.PUBLIC_URL.replace(/\/$/, "");
  const path = config.OIDC_CALLBACK_PATH.startsWith("/")
    ? config.OIDC_CALLBACK_PATH
    : `/${config.OIDC_CALLBACK_PATH}`;
  return `${base}${path}`;
}

function callbackRoutePath(): string {
  return config.OIDC_CALLBACK_PATH.startsWith("/")
    ? config.OIDC_CALLBACK_PATH
    : `/${config.OIDC_CALLBACK_PATH}`;
}

export async function oidcRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/auth/oidc/login", async (req, reply) => {
    if (!config.OIDC_ENABLED) {
      return reply.code(404).send({ error: "OIDC not enabled on server" });
    }
    const settings = await getAdminSettings();
    if (!settings.oidcEnabled) {
      return reply.code(404).send({ error: "OIDC not enabled in admin settings" });
    }

    const issuerUrl = settings.oidcIssuerUrl ?? config.OIDC_ISSUER_URL;
    const clientId = settings.oidcClientId ?? config.OIDC_CLIENT_ID;
    const clientSecret = config.OIDC_CLIENT_SECRET;

    if (!issuerUrl || !clientId || !clientSecret) {
      return reply.code(500).send({ error: "OIDC issuer, client ID, or client secret missing" });
    }

    const issuerCheck = validateIssuerUrl(issuerUrl);
    if (!issuerCheck.ok) {
      req.log.warn(
        { reason: issuerCheck.reason, issuerUrl },
        "oidc: refusing to start login flow — issuer URL failed SSRF guard",
      );
      return reply.code(500).send({ error: `Invalid OIDC issuer URL: ${issuerCheck.reason}` });
    }

    const conf = await discovery(
      issuerCheck.url,
      clientId,
      { redirect_uris: [callbackUri()] },
      ClientSecretPost(clientSecret),
    );

    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const state = randomBytes(24).toString("hex");

    req.session.oidcCodeVerifier = codeVerifier;
    req.session.oidcState = state;

    const redirectTo = buildAuthorizationUrl(conf, {
      redirect_uri: callbackUri(),
      scope: "openid email profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });

    return reply.redirect(redirectTo.toString());
  });

  app.get(callbackRoutePath(), async (req, reply) => {
    if (!config.OIDC_ENABLED) {
      return reply.code(404).send({ error: "OIDC not enabled" });
    }

    const settings = await getAdminSettings();
    const issuerUrl = settings.oidcIssuerUrl ?? config.OIDC_ISSUER_URL;
    const clientId = settings.oidcClientId ?? config.OIDC_CLIENT_ID;
    const clientSecret = config.OIDC_CLIENT_SECRET;

    if (!issuerUrl || !clientId || !clientSecret) {
      return reply.code(500).send({ error: "OIDC misconfigured" });
    }

    const issuerCheck = validateIssuerUrl(issuerUrl);
    if (!issuerCheck.ok) {
      req.log.warn(
        { reason: issuerCheck.reason, issuerUrl },
        "oidc: refusing to complete callback — issuer URL failed SSRF guard",
      );
      return reply.code(500).send({ error: "OIDC misconfigured" });
    }

    const conf = await discovery(
      issuerCheck.url,
      clientId,
      { redirect_uris: [callbackUri()] },
      ClientSecretPost(clientSecret),
    );

    const currentUrl = new URL(req.url, config.PUBLIC_URL);

    let tokens;
    try {
      tokens = await authorizationCodeGrant(conf, currentUrl, {
        pkceCodeVerifier: req.session.oidcCodeVerifier,
        expectedState: req.session.oidcState,
      });
    } catch {
      return reply.code(400).send({ error: "OIDC callback failed" });
    }

    const claims = tokens.claims();
    const emailRaw = claims?.email ?? claims?.sub;
    if (!emailRaw || typeof emailRaw !== "string") {
      return reply.code(400).send({ error: "Token missing email or sub" });
    }
    const email = emailRaw.toLowerCase();

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const passwordHash = await bcrypt.hash(randomBytes(48).toString("hex"), 12);
      user = await prisma.user.create({
        data: { email, passwordHash, role: UserRole.USER },
      });
    }

    // Regenerate the session ID before binding the authenticated user. The pre-auth session
    // only held the one-time OIDC state + PKCE verifier, both consumed above — rotating the
    // ID here prevents a fixed pre-auth cookie from being carried into the authenticated
    // state. `regenerate` wipes the prior session, so we set `userId` after.
    await req.session.regenerate();
    req.session.userId = user.id;

    const front = (process.env.FRONTEND_URL ?? config.PUBLIC_URL).replace(/\/$/, "");
    return reply.redirect(`${front}/`);
  });
}
