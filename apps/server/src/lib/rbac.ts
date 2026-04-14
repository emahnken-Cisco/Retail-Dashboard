import type { FastifyReply, FastifyRequest } from "fastify";
import { UserRole } from "@prisma/client";
import { prisma } from "./prisma.js";

export { UserRole };

export async function getUserRole(userId: string | undefined): Promise<UserRole | null> {
  if (!userId) {
    return null;
  }
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return row?.role ?? null;
}

/** Session must exist; load role and require one of `allowed`. */
export function requireRoles(...allowed: UserRole[]) {
  return async function requireRolesHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const uid = req.session?.userId as string | undefined;
    if (!uid) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    const role = await getUserRole(uid);
    if (!role || !allowed.includes(role)) {
      reply.code(403).send({ error: "Forbidden" });
    }
  };
}

export const requireOrgAdmin = requireRoles(UserRole.ORG_ADMIN);

/** Org admin or location/circuit editors (sites, circuits, tags CRUD). */
export const requireSiteEditor = requireRoles(UserRole.ORG_ADMIN, UserRole.LOCATION_CIRCUIT);

/** Tags + TE/Meraki tag tooling (not read-only users). */
export const requireTagEditor = requireRoles(UserRole.ORG_ADMIN, UserRole.LOCATION_CIRCUIT);

/** API debug: list traces (read). */
export const requireDebugReader = requireRoles(
  UserRole.ORG_ADMIN,
  UserRole.LOCATION_CIRCUIT,
);
