import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { ROLE_LABELS, type UserRole } from "../lib/roles.js";

type Row = {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
};

const ROLES: UserRole[] = ["ORG_ADMIN", "LOCATION_CIRCUIT", "USER"];

export function AdminUsersPage() {
  const [users, setUsers] = useState<Row[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("USER");

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await api<{ users: Row[] }>("/api/admin/users");
      setUsers(r.users ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load users");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setErr("");
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: newEmail.trim(),
          password: newPassword,
          role: newRole,
        }),
      });
      setNewEmail("");
      setNewPassword("");
      setNewRole("USER");
      setMsg("User created.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    }
  }

  async function updateRole(id: string, role: UserRole) {
    setErr("");
    try {
      await api(`/api/admin/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function removeUser(id: string) {
    if (!confirm("Remove this user? They will no longer be able to sign in.")) {
      return;
    }
    setErr("");
    try {
      await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div>
      <p style={{ marginBottom: "0.75rem" }}>
        <Link to="/admin" className="btn secondary" style={{ fontSize: "0.85rem", padding: "0.35rem 0.65rem" }}>
          ← Admin settings
        </Link>
      </p>
      <h1>User admin</h1>
      <p style={{ color: "var(--muted)", maxWidth: "42rem", lineHeight: 1.5 }}>
        <strong>Organization Admin</strong> — full access to settings, API keys, locations, circuits, tags, and
        users. <strong>Location &amp; Circuit</strong> — edit locations, circuits, and tags; API debug is read-only.{" "}
        <strong>User</strong> — dashboard and reporting read-only; no admin, tags, keys, or API debug.
      </p>

      {err ? (
        <p className="card" style={{ marginTop: "1rem", color: "var(--danger)" }}>
          {err}
        </p>
      ) : null}
      {msg ? (
        <p style={{ marginTop: "0.75rem", color: "var(--accent)" }} role="status">
          {msg}
        </p>
      ) : null}

      <section className="card" style={{ marginTop: "1.25rem", maxWidth: 480 }}>
        <h2 style={{ marginTop: 0 }}>Add user</h2>
        <form onSubmit={(e) => void createUser(e)}>
          <div className="form-group">
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              autoComplete="off"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="label">Initial password (min 10 characters)</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={10}
            />
          </div>
          <div className="form-group">
            <label className="label">Role</label>
            <select
              className="input"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn">
            Create user
          </button>
        </form>
      </section>

      <h2 style={{ marginTop: "2rem" }}>Users</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--surface2)", color: "var(--muted)" }}>
              <th style={{ padding: "0.5rem" }}>Email</th>
              <th style={{ padding: "0.5rem" }}>Role</th>
              <th style={{ padding: "0.5rem" }}>Created</th>
              <th style={{ padding: "0.5rem" }} />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: "1px solid var(--surface2)" }}>
                <td style={{ padding: "0.5rem" }}>{u.email}</td>
                <td style={{ padding: "0.5rem" }}>
                  <select
                    className="input"
                    style={{ fontSize: "0.85rem", minWidth: 200 }}
                    value={u.role}
                    onChange={(e) => void updateRole(u.id, e.target.value as UserRole)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: "0.5rem", color: "var(--muted)", fontSize: "0.8rem" }}>
                  {new Date(u.createdAt).toLocaleString()}
                </td>
                <td style={{ padding: "0.5rem" }}>
                  <button type="button" className="btn secondary" onClick={() => void removeUser(u.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
