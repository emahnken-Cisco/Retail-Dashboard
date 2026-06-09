import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./auth.js";
import { useEffect, useState } from "react";
import { api } from "./api.js";
import {
  canViewAdminSettings,
  canViewApiDebug,
  canViewApiKeys,
  canViewTags,
  canViewUserAdmin,
} from "./lib/roles.js";

export function Layout() {
  const { logout, user } = useAuth();
  const role = user?.role;
  const [intervalSec, setIntervalSec] = useState<number | null>(null);

  useEffect(() => {
    let t: ReturnType<typeof setInterval> | undefined;
    (async () => {
      try {
        const c = await api<{ heartbeatIntervalSec: number }>("/api/session/config");
        setIntervalSec(c.heartbeatIntervalSec);
        t = setInterval(() => {
          void api("/api/session/ping").catch(() => {});
        }, Math.max(30_000, c.heartbeatIntervalSec * 1000));
      } catch {
        /* optional */
      }
    })();
    return () => {
      if (t) clearInterval(t);
    };
  }, []);

  return (
    <div className="layout">
      <aside className="sidebar">
        <NavLink to="/" end>
          Dashboard
        </NavLink>
        <NavLink to="/sites">Locations</NavLink>
        {canViewTags(role) ? <NavLink to="/tags">Tags</NavLink> : null}
        <NavLink to="/circuits">Circuits</NavLink>
        <NavLink to="/reporting">Reporting</NavLink>
        {canViewAdminSettings(role) ? (
          <>
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.35rem 1.25rem 0",
                fontSize: "0.72rem",
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Admin
            </div>
            <NavLink to="/admin">Settings</NavLink>
            {canViewUserAdmin(role) ? <NavLink to="/admin/users">User admin</NavLink> : null}
            {canViewApiKeys(role) ? <NavLink to="/admin/credentials">API keys</NavLink> : null}
            <NavLink to="/admin/wireless-capacity">Wireless capacity</NavLink>
          </>
        ) : null}
        {canViewApiDebug(role) ? <NavLink to="/debug">API debug</NavLink> : null}
        <div style={{ marginTop: "2rem", padding: "0 1.25rem", fontSize: "0.8rem", color: "var(--muted)" }}>
          {user?.email}
          {intervalSec != null ? (
            <div style={{ marginTop: "0.5rem" }}>Keep-alive ~{intervalSec}s</div>
          ) : null}
        </div>
        <button
          type="button"
          className="btn secondary"
          style={{ margin: "1rem 1.25rem", width: "calc(100% - 2.5rem)" }}
          onClick={() => void logout()}
        >
          Sign out
        </button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
