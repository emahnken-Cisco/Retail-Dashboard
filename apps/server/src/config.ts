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
  CREDENTIALS_MASTER_KEY: z.string().min(1),
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
  ADMIN_BOOTSTRAP_EMAIL: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
    z.string().email().optional(),
  ),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  HTTPS_ENABLED: parsed.data.HTTPS_ENABLED ?? false,
  OIDC_ENABLED: parsed.data.OIDC_ENABLED ?? false,
  TLS_CERT_PATH: parsed.data.TLS_CERT_PATH || undefined,
  TLS_KEY_PATH: parsed.data.TLS_KEY_PATH || undefined,
  OIDC_ISSUER_URL: parsed.data.OIDC_ISSUER_URL || undefined,
  OIDC_CLIENT_ID: parsed.data.OIDC_CLIENT_ID || undefined,
  OIDC_CLIENT_SECRET: parsed.data.OIDC_CLIENT_SECRET || undefined,
};

export type AppConfig = typeof config;
