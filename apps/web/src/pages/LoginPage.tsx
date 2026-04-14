import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.js";

export function LoginPage() {
  const { user, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [oidc, setOidc] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const s = await api<{ oidcAvailable?: boolean }>("/api/public/auth-options");
        setOidc(Boolean(s.oidcAvailable));
      } catch {
        setOidc(false);
      }
      try {
        const st = await api<{ needsSetup: boolean }>("/api/setup/status");
        setSetupNeeded(st.needsSetup);
      } catch {
        setSetupNeeded(false);
      }
    })();
  }, []);

  if (setupNeeded === null) {
    return <div className="main">Loading…</div>;
  }

  if (setupNeeded) {
    return <Navigate to="/setup" replace />;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Login failed");
    }
  }

  return (
    <div className="main" style={{ maxWidth: 440, margin: "3rem auto" }}>
      <h1>Sign in</h1>
      <p style={{ color: "var(--muted)" }}>Retail Operations Dashboard</p>
      {oidc ? (
        <p>
          <a className="btn" href="/api/auth/oidc/login" style={{ display: "inline-flex", textDecoration: "none" }}>
            Continue with SSO
          </a>
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="card" style={{ marginTop: "1.5rem" }}>
        <div className="form-group">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div className="form-group">
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {err ? <p style={{ color: "var(--danger)" }}>{err}</p> : null}
        <button type="submit" className="btn">
          Sign in
        </button>
      </form>
    </div>
  );
}
