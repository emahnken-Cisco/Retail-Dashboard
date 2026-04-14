import type { FastifyInstance } from "fastify";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma.js";
import { requireOrgAdmin } from "../lib/rbac.js";

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

      const ts = Date.now();
      const certPath = resolve(certsDir, `server-${ts}.crt`);
      const keyPath = resolve(certsDir, `server-${ts}.key`);
      await writeFile(certPath, certPem, { mode: 0o600 });
      await writeFile(keyPath, keyPem, { mode: 0o600 });

      await prisma.adminSettings.update({
        where: { id: "singleton" },
        data: { tlsCertPath: certPath, tlsKeyPath: keyPath },
      });

      return {
        ok: true,
        tlsCertPath: certPath,
        tlsKeyPath: keyPath,
        message:
          "Set TLS_CERT_PATH and TLS_KEY_PATH in .env to these paths, set HTTPS_ENABLED=true, and restart the server.",
      };
    },
  );
}
