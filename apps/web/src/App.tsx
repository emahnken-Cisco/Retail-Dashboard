import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth.js";
import { Layout } from "./Layout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { SetupPage } from "./pages/SetupPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { AdminPage } from "./pages/AdminPage.js";
import { SitesPage } from "./pages/SitesPage.js";
import { CredentialsPage } from "./pages/CredentialsPage.js";
import { ApiDebugPage } from "./pages/ApiDebugPage.js";
import { TagsPage } from "./pages/TagsPage.js";
import { CircuitsPage } from "./pages/CircuitsPage.js";
import { ReportingPage } from "./pages/ReportingPage.js";
import { AdminUsersPage } from "./pages/AdminUsersPage.js";
import { AdminWirelessCapacityPage } from "./pages/AdminWirelessCapacityPage.js";
import type { UserRole } from "./lib/roles.js";

function Private({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="main">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function RoleRoute({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="main">Loading…</div>;
  }
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <Private>
              <Layout />
            </Private>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="sites" element={<SitesPage />} />
          <Route path="circuits" element={<CircuitsPage />} />
          <Route path="reporting" element={<ReportingPage />} />
          <Route
            path="admin"
            element={
              <RoleRoute roles={["ORG_ADMIN"]}>
                <AdminPage />
              </RoleRoute>
            }
          />
          <Route
            path="admin/users"
            element={
              <RoleRoute roles={["ORG_ADMIN"]}>
                <AdminUsersPage />
              </RoleRoute>
            }
          />
          <Route
            path="admin/credentials"
            element={
              <RoleRoute roles={["ORG_ADMIN"]}>
                <CredentialsPage />
              </RoleRoute>
            }
          />
          <Route
            path="admin/wireless-capacity"
            element={
              <RoleRoute roles={["ORG_ADMIN"]}>
                <AdminWirelessCapacityPage />
              </RoleRoute>
            }
          />
          <Route
            path="debug"
            element={
              <RoleRoute roles={["ORG_ADMIN", "LOCATION_CIRCUIT"]}>
                <ApiDebugPage />
              </RoleRoute>
            }
          />
          <Route
            path="tags"
            element={
              <RoleRoute roles={["ORG_ADMIN", "LOCATION_CIRCUIT"]}>
                <TagsPage />
              </RoleRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
