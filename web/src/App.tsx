import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/lib/auth/auth-context";
import { firstReadableRoute } from "@/lib/auth/authorization";
import { ProtectedShell } from "@/components/layout/protected-shell";
import LoginPage from "@/pages/login-page";
import WorkOrdersPage from "@/pages/work-orders-page";
import WorkOrderDetailPage from "@/pages/work-order-detail-page";
import UsersPage from "@/pages/users-page";
import RolesPage from "@/pages/roles-page";

function HomeRedirect() {
  const { loading, scope } = useAuth();
  if (loading) return null;
  return <Navigate to={firstReadableRoute(scope)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/work-orders"
        element={
          <ProtectedShell>
            <WorkOrdersPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/work-orders/:referenceId"
        element={
          <ProtectedShell>
            <WorkOrderDetailPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/users"
        element={
          <ProtectedShell>
            <UsersPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/roles"
        element={
          <ProtectedShell>
            <RolesPage />
          </ProtectedShell>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
