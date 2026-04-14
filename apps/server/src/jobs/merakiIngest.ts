import { prisma } from "../lib/prisma.js";
import { getMerakiApiKey } from "../lib/merakiVault.js";
import {
  listOrganizations,
  listNetworks,
  listNetworkDevices,
  getOrganizationApplianceUplinkStatuses,
  getOrganizationDevicesAvailabilitiesForNetworks,
  getNetworkAlertsHistory,
} from "../lib/merakiClient.js";
import { summarizeApplianceWanPaths, type MerakiWanApplianceSummary } from "../lib/merakiWanSummary.js";
import { recordCircuitOutagesAfterSnapshot } from "../lib/circuitOutageRecorder.js";
import { recordCircuitEventsAfterSnapshot } from "../lib/circuitEventRecorder.js";
import type { Prisma } from "@prisma/client";

function isMerakiApplianceModel(model: string | undefined): boolean {
  if (!model) {
    return false;
  }
  const u = model.toUpperCase();
  return u.startsWith("MX") || u.startsWith("MG") || u.startsWith("VMX") || /^Z\d/.test(u);
}

export async function runMerakiIngest(): Promise<void> {
  const run = await prisma.ingestRun.create({
    data: { jobType: "meraki", status: "running" },
  });
  try {
    const apiKey = await getMerakiApiKey();
    if (!apiKey) {
      await prisma.ingestRun.update({
        where: { id: run.id },
        data: { status: "skipped", finishedAt: new Date(), errorSummary: "No Meraki API key configured" },
      });
      return;
    }

    const orgs = await listOrganizations(apiKey);
    const sites = await prisma.site.findMany();
    const byNetwork = new Map(sites.filter((s) => s.merakiNetworkId).map((s) => [s.merakiNetworkId!, s]));

    for (const org of orgs) {
      const networks = await listNetworks(apiKey, org.id);
      const allNetworkIds = networks.map((n) => n.id);
      const trackedNetIdsInOrg = networks.filter((n) => byNetwork.has(n.id)).map((n) => n.id);

      let serialToStatus = new Map<string, string>();
      try {
        serialToStatus = await getOrganizationDevicesAvailabilitiesForNetworks(apiKey, org.id, allNetworkIds);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[meraki ingest] device availabilities failed for org ${org.id}: ${msg.slice(0, 300)}`);
      }

      let uplinkByNetwork = new Map<string, MerakiWanApplianceSummary[]>();
      let uplinkOrgFetchError: string | null = null;
      if (trackedNetIdsInOrg.length > 0) {
        try {
          const uplinkRows = await getOrganizationApplianceUplinkStatuses(apiKey, org.id, {
            networkIds: trackedNetIdsInOrg,
          });
          for (const row of uplinkRows) {
            const summary = summarizeApplianceWanPaths(row);
            const list = uplinkByNetwork.get(row.networkId) ?? [];
            list.push(summary);
            uplinkByNetwork.set(row.networkId, list);
          }
        } catch (e) {
          uplinkOrgFetchError = e instanceof Error ? e.message : String(e);
          console.warn(`[meraki ingest] appliance uplink statuses failed for org ${org.id}: ${uplinkOrgFetchError.slice(0, 400)}`);
          uplinkByNetwork = new Map();
        }
      }

      for (const net of networks) {
        const devices = await listNetworkDevices(apiKey, net.id);
        const site = byNetwork.get(net.id);
        const edgeGear = devices.filter(
          (d) =>
            d.model?.startsWith("MX") ||
            d.model?.startsWith("MR") ||
            d.model?.startsWith("MS") ||
            d.model?.startsWith("CW") ||
            d.model?.startsWith("MV"),
        );

        let wanAppliances = uplinkByNetwork.get(net.id) ?? [];

        if (wanAppliances.length === 0) {
          const applianceSerials = edgeGear.filter((d) => isMerakiApplianceModel(d.model)).map((d) => d.serial);
          if (applianceSerials.length > 0) {
            try {
              const rows = await getOrganizationApplianceUplinkStatuses(apiKey, org.id, { serials: applianceSerials });
              const forNet = rows.filter((r) => r.networkId === net.id);
              wanAppliances = forNet.map((r) => summarizeApplianceWanPaths(r));
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.warn(`[meraki ingest] uplink fallback by serial for net ${net.id}: ${msg.slice(0, 300)}`);
            }
          }
        }

        const hasApplianceGear = edgeGear.some((d) => isMerakiApplianceModel(d.model));
        let wanNote: string | null = null;
        if (hasApplianceGear && wanAppliances.length === 0) {
          wanNote =
            uplinkOrgFetchError?.slice(0, 500) ??
            "No appliance uplink data returned. Ensure the API key includes SD-WAN / appliance telemetry read (e.g. sdwan:telemetry:read) and the MX is reporting in Dashboard.";
        }

        let alertsHistory: Array<{
          occurredAt: string;
          alertTypeId: string;
          alertType: string;
          deviceSerial: string;
        }> = [];
        let alertsHistoryNote: string | null = null;
        if (site) {
          try {
            const rawAlerts = await getNetworkAlertsHistory(apiKey, net.id, 50);
            const list = Array.isArray(rawAlerts) ? rawAlerts : [];
            alertsHistory = list.slice(0, 50).map((a) => ({
              occurredAt: String(a.occurredAt ?? ""),
              alertTypeId: String(a.alertTypeId ?? "—"),
              alertType: String(a.alertType ?? a.alertTypeId ?? "—"),
              deviceSerial: String(a.device?.serial ?? "—"),
            }));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            alertsHistoryNote = msg.slice(0, 400);
            console.warn(`[meraki ingest] alerts history for net ${net.id}: ${msg.slice(0, 300)}`);
          }
        }

        const payload = {
          organizationId: org.id,
          organizationName: org.name,
          networkId: net.id,
          networkName: net.name,
          deviceCount: devices.length,
          mxMrCount: edgeGear.length,
          edgeEquipmentCount: edgeGear.length,
          devices: edgeGear.slice(0, 200).map((d) => ({
            serial: d.serial,
            name: d.name,
            model: d.model,
            status: serialToStatus.get(d.serial) ?? d.status ?? "unknown",
            lat: d.lat,
            lng: d.lng,
          })),
          wan: wanAppliances.length
            ? {
                appliances: wanAppliances.map((a) => ({
                  serial: a.serial,
                  model: a.model,
                  lastReportedAt: a.lastReportedAt,
                  highAvailability: a.highAvailability,
                  pathSummary: a.pathSummary,
                  activeInterfaces: a.activeInterfaces,
                  wan1Status: a.wan1Status,
                  wan2Status: a.wan2Status,
                  cellularStatus: a.cellularStatus,
                  uplinks: a.uplinks.map((u) => ({
                    interface: u.interface,
                    status: u.status,
                    ip: u.ip ?? null,
                    gateway: u.gateway ?? null,
                    publicIp: u.publicIp ?? null,
                    primaryDns: u.primaryDns ?? null,
                    secondaryDns: u.secondaryDns ?? null,
                    ipAssignedBy: u.ipAssignedBy ?? null,
                  })),
                })),
              }
            : null,
          wanNote,
          alertsHistory,
          alertsHistoryNote,
        };

        await prisma.metricSnapshot.create({
          data: {
            siteId: site?.id ?? null,
            source: "meraki",
            payload,
          },
        });
        if (site?.id) {
          const capturedAt = new Date();
          await recordCircuitOutagesAfterSnapshot(site.id, payload as Prisma.JsonValue, capturedAt);
          await recordCircuitEventsAfterSnapshot(site.id, payload as Prisma.JsonValue, capturedAt);
        }
      }
    }

    await prisma.ingestRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date() },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: { status: "error", finishedAt: new Date(), errorSummary: msg.slice(0, 2000) },
    });
  }
}
