import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import PortalConfigMissing from "./PortalConfigMissing";
import { firebaseReady } from "../lib/firebase";

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="portal-shell">
        <div className="portal-card">Loading portal...</div>
      </div>
    );
  }

  if (!firebaseReady) {
    return <PortalConfigMissing />;
  }

  if (!user) {
    return <Navigate to="/portal/login" replace />;
  }

  return children;
};

export default ProtectedRoute;
