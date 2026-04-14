import { prisma } from "./prisma.js";

export async function getAdminSettings() {
  let row = await prisma.adminSettings.findUnique({ where: { id: "singleton" } });
  if (!row) {
    row = await prisma.adminSettings.create({
      data: { id: "singleton" },
    });
  }
  return row;
}
