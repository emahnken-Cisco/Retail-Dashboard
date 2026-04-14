/** Mirrors server `UserRole` enum. */
export type UserRole = "ORG_ADMIN" | "LOCATION_CIRCUIT" | "USER";

export const ROLE_LABELS: Record<UserRole, string> = {
  ORG_ADMIN: "Organization Admin",
  LOCATION_CIRCUIT: "Location & Circuit",
  USER: "User (read-only)",
};

export function canEditStores(role: UserRole | undefined): boolean {
  return role === "ORG_ADMIN" || role === "LOCATION_CIRCUIT";
}

export function isOrgAdmin(role: UserRole | undefined): boolean {
  return role === "ORG_ADMIN";
}

export function canViewTags(role: UserRole | undefined): boolean {
  return role === "ORG_ADMIN" || role === "LOCATION_CIRCUIT";
}

export function canViewAdminSettings(role: UserRole | undefined): boolean {
  return role === "ORG_ADMIN";
}

export function canViewUserAdmin(role: UserRole | undefined): boolean {
  return role === "ORG_ADMIN";
}

export function canViewApiKeys(role: UserRole | undefined): boolean {
  return role === "ORG_ADMIN";
}

/** API debug page: org admin full; location editor read-only (no clear traces). */
export function canViewApiDebug(role: UserRole | undefined): boolean {
  return role === "ORG_ADMIN" || role === "LOCATION_CIRCUIT";
}

export function canClearOutboundTraces(role: UserRole | undefined): boolean {
  return role === "ORG_ADMIN";
}
