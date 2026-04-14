import { useCallback, useEffect, useState } from "react";
import type { MerakiDeviceRow } from "../lib/sitePayloads.js";
import { api } from "../api.js";

const REFRESH_MS = 25_000;

type VideoLinkResponse = {
  url: string | null;
  visionUrl: string | null;
};

export function MerakiCameraSidecar({
  siteId,
  camera,
  open,
  onClose,
}: {
  siteId: string;
  camera: MerakiDeviceRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const [visionUrl, setVisionUrl] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);

  const serial = camera?.serial ?? "";
  /** Prefer Vision URL for opening in a new tab (matches Dashboard experience). */
  const openHref = (visionUrl && visionUrl.trim()) || (streamUrl && streamUrl.trim()) || null;

  const loadLink = useCallback(async () => {
    if (!siteId || !serial) {
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const r = await api<VideoLinkResponse>(
        `/api/dashboard/sites/${encodeURIComponent(siteId)}/meraki-cameras/${encodeURIComponent(serial)}/video-link`,
      );
      const v = r.visionUrl && r.visionUrl.trim() ? r.visionUrl.trim() : null;
      const u = r.url && r.url.trim() ? r.url.trim() : null;
      if (!v && !u) {
        setErr("Meraki returned no video or Vision URL. Check API key camera permissions and MV licensing.");
        setVisionUrl(null);
        setStreamUrl(null);
      } else {
        setVisionUrl(v);
        setStreamUrl(u);
      }
    } catch (e) {
      setVisionUrl(null);
      setStreamUrl(null);
      setErr(e instanceof Error ? e.message : "Failed to load camera link");
    } finally {
      setLoading(false);
    }
  }, [siteId, serial]);

  useEffect(() => {
    if (!open || !serial) {
      setVisionUrl(null);
      setStreamUrl(null);
      setErr("");
      setShowEmbed(false);
      return;
    }
    void loadLink();
    const t = window.setInterval(() => void loadLink(), REFRESH_MS);
    return () => window.clearInterval(t);
  }, [open, serial, loadLink]);

  useEffect(() => {
    if (!open) {
      setShowEmbed(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function openMerakiWindow() {
    if (!openHref) {
      return;
    }
    window.open(openHref, "_blank", "noopener,noreferrer");
  }

  if (!open || !camera) {
    return null;
  }

  return (
    <>
      <div
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 1100,
        }}
        onClick={onClose}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      />
      <aside
        className="card"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(640px, 100vw)",
          maxWidth: "100%",
          zIndex: 1110,
          margin: 0,
          borderRadius: "12px 0 0 12px",
          borderRight: "none",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "-8px 0 24px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "0.75rem",
            padding: "1rem 1rem 0.75rem",
            borderBottom: "1px solid var(--surface2)",
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem", lineHeight: 1.3 }}>Meraki camera</h2>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>{camera.name}</p>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.72rem",
                color: "var(--muted)",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {camera.model} · {camera.serial}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", flexShrink: 0 }}>
            <button
              type="button"
              className="btn secondary"
              style={{ fontSize: "0.75rem" }}
              disabled={loading}
              onClick={() => void loadLink()}
            >
              {loading ? "…" : "Refresh link"}
            </button>
            <button type="button" className="btn secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "0.75rem 1rem 1rem", overflow: "auto" }}>
          {err ? (
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: "var(--danger)", lineHeight: 1.45 }}>
              {err}
            </p>
          ) : null}

          {openHref ? (
            <div
              style={{
                padding: "0.85rem 1rem",
                borderRadius: 8,
                border: "1px solid var(--surface2)",
                background: "var(--surface2)",
                marginBottom: "0.85rem",
              }}
            >
              <p style={{ margin: "0 0 0.65rem", fontSize: "0.8rem", lineHeight: 1.5, color: "var(--text)" }}>
                <strong>Live view opens in Meraki</strong> — not inside this panel. When this site embeds Meraki in an
                iframe, your browser treats it as a separate context:{" "}
                <strong>login cookies from another tab are not shared</strong> with the embed, and Meraki often blocks or
                breaks embedded Vision anyway. Use the button below (same as a normal new tab).
              </p>
              <button
                type="button"
                className="btn"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={openMerakiWindow}
              >
                Open live view in Meraki
              </button>
              <p style={{ margin: "0.55rem 0 0", fontSize: "0.72rem", color: "var(--muted)", lineHeight: 1.45 }}>
                Links refresh about every {Math.round(REFRESH_MS / 1000)}s while this panel is open. If Meraki says the
                link expired, click <strong>Refresh link</strong> above.
              </p>
            </div>
          ) : !loading && !err ? (
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>No link yet.</p>
          ) : null}

          <details
            style={{ marginTop: "0.25rem", fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.45 }}
            onToggle={(e) => setShowEmbed((e.target as HTMLDetailsElement).open)}
          >
            <summary style={{ cursor: "pointer", color: "var(--text)", fontWeight: 600 }}>
              Try embedded preview (usually blank or broken)
            </summary>
            <p style={{ margin: "0.5rem 0 0.65rem" }}>
              Optional iframe using the same URL. Expect failures due to third-party cookies and Meraki frame policy — this
              is why the button above is recommended.
            </p>
            {openHref && showEmbed ? (
              <div
                style={{
                  minHeight: 240,
                  height: 320,
                  border: "1px solid var(--surface2)",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "#111",
                }}
              >
                <iframe
                  key={openHref}
                  title={`Meraki camera preview ${camera.serial}`}
                  src={openHref}
                  style={{ width: "100%", height: "100%", border: "none" }}
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : null}
          </details>

          {openHref ? (
            <p style={{ margin: "0.85rem 0 0", fontSize: "0.72rem" }}>
              <a href={openHref} target="_blank" rel="noopener noreferrer">
                Open same link in new tab (link)
              </a>
            </p>
          ) : null}
        </div>
      </aside>
    </>
  );
}
