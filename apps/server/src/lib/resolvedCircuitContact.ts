export type SiteLocalContactFields = {
  localContactPrimaryName: string | null;
  localContactPrimaryPhone: string | null;
  localContactPrimaryEmail: string | null;
  localContactSecondaryName: string | null;
  localContactSecondaryPhone: string | null;
  localContactSecondaryEmail: string | null;
};

/** Resolved contact for API / dashboard (circuits reference store slots). */
export function resolvedLocalContactFromSite(
  site: SiteLocalContactFields,
  slot: "PRIMARY" | "SECONDARY" | null | undefined,
): { localContactName: string | null; localContactPhone: string | null; localContactEmail: string | null } {
  if (slot === "PRIMARY") {
    return {
      localContactName: site.localContactPrimaryName?.trim() || null,
      localContactPhone: site.localContactPrimaryPhone?.trim() || null,
      localContactEmail: site.localContactPrimaryEmail?.trim() || null,
    };
  }
  if (slot === "SECONDARY") {
    return {
      localContactName: site.localContactSecondaryName?.trim() || null,
      localContactPhone: site.localContactSecondaryPhone?.trim() || null,
      localContactEmail: site.localContactSecondaryEmail?.trim() || null,
    };
  }
  return { localContactName: null, localContactPhone: null, localContactEmail: null };
}
