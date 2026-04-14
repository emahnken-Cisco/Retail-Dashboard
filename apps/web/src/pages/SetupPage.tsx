import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";

export function SetupPage() {
  const [needs, setNeeds] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    void api<{ needsSetup: boolean }>("/api/setup/status").then((s) => setNeeds(s.needsSetup));
  }, []);

  if (needs === false) {
    return <Navigate to="/login" replace />;
  }
  if (needs === null) {
    return <div className="main">Loading…</div>;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await api("/api/setup", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      window.location.href = "/";
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Setup failed");
    }
  }

  return (
    <div className="main" style={{ maxWidth: 440, margin: "3rem auto" }}>
      <h1>Initial setup</h1>
      <p style={{ color: "var(--muted)" }}>Create the first administrator account.</p>
      <form onSubmit={onSubmit} className="card" style={{ marginTop: "1.5rem" }}>
        <div className="form-group">
          <label className="label" htmlFor="e">
            Email
          </label>
          <input id="e" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="label" htmlFor="p">
            Password (min 10 chars)
          </label>
          <input
            id="p"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {err ? <p style={{ color: "var(--danger)" }}>{err}</p> : null}
        <button type="submit" className="btn">
          Complete setup
        </button>
      </form>
    </div>
  );
}
