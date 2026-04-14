import { prisma } from "./prisma.js";
import { decryptSecretForHttp } from "./cryptoVault.js";

export async function getMerakiApiKey(): Promise<string | null> {
  const row = await prisma.credentialVault.findUnique({ where: { provider: "meraki" } });
  if (!row) {
    return null;
  }
  return decryptSecretForHttp(row.encryptedValue, row.iv, row.authTag, "Meraki API key");
}
