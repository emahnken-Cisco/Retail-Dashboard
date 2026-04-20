import type { FastifyInstance } from "fastify";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma.js";
import { requireOrgAdmin } from "../lib/rbac.js";
import { validateTlsPemPair } from "../lib/tlsValidation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const certsDir = resolve(__dirname, "../../certs");

export async function tlsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/admin/tls/upload",
    { preHandler: requireOrgAdmin },
    async (req, reply) => {
      let certPem = "";
      let keyPem = "";

      for await (const part of req.parts()) {
        if (part.type === "file") {
          // Enforce explicit fieldname allow-list so an attacker can't pile arbitrary
          // multipart parts onto the request to fill memory / temp storage.
          if (part.fieldname !== "cert" && part.fieldname !== "key") {
            continue;
          }
          const buf = await part.toBuffer();
          const text = buf.toString("utf8");
          if (part.fieldname === "cert") {
            certPem = text;
          } else if (part.fieldname === "key") {
            keyPem = text;
          }
        }
      }

      if (!certPem || !keyPem) {
        return reply
          .code(400)
          .send({ error: "Upload cert and key PEM files as multipart fields cert and key" });
      }

      // Validate PEM structure, parse as X.509, verify the private key matches the cert, and
      // confirm the cert's validity window straddles now. Without this the upload was an
      // arbitrary-file-write-to-server primitive gated only by admin auth — any bad content
      // would land on disk at a known path, including content that later gets served by
      // callers that assume it's a valid certificate.
      const validation = validateTlsPemPair(certPem, keyPem);
      if (!validation.ok) {
        req.log.warn({ reason: validation.error }, "TLS upload rejected by PEM validator");
        return reply.code(400).send({ error: validation.error });
      }

      await mkdir(certsDir, { recursive: true });
      const ts = Date.now();
      const certPath = resolve(certsDir, `server-${ts}.crt`);
      const keyPath = resolve(certsDir, `server-${ts}.key`);
      // Normalize to LF-terminated PEM so downstream `readFileSync` consumers see a canonical
      // form regardless of the uploader's OS. Restrictive file mode limits read access to the
      // process owner; `mode` works on Windows too (it maps to read-only bits).
      const canonicalCert = `${certPem.trim().replace(/\r\n/g, "\n")}\n`;
      const canonicalKey = `${keyPem.trim().replace(/\r\n/g, "\n")}\n`;
      await writeFile(certPath, canonicalCert, { mode: 0o600 });
      await writeFile(keyPath, canonicalKey, { mode: 0o600 });

      await prisma.adminSettings.update({
        where: { id: "singleton" },
        data: { tlsCertPath: certPath, tlsKeyPath: keyPath },
      });

      const cert = validation.cert;
      return {
        ok: true,
        tlsCertPath: certPath,
        tlsKeyPath: keyPath,
        certificate: {
          subject: cert.subject,
          issuer: cert.issuer,
          validFrom: cert.validFrom,
          validTo: cert.validTo,
          fingerprint256: cert.fingerprint256,
        },
        message:
          "Set TLS_CERT_PATH and TLS_KEY_PATH in .env to these paths, set HTTPS_ENABLED=true, and restart the server.",
      };
    },
  );
}
