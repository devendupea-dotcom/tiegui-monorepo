import { Navigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { db, firebaseReady } from "../lib/firebase";
import PortalAccessDenied from "./PortalAccessDenied";
import PortalConfigMissing from "./PortalConfigMissing";

const StaffRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const [staffCheck, setStaffCheck] = useState({ loading: true, isStaff: false });

  useEffect(() => {
    let active = true;
    const runCheck = async () => {
      if (!firebaseReady || !db || !user?.email) {
        if (active) setStaffCheck({ loading: false, isStaff: false });
        return;
      }
      try {
        const docRef = doc(db, "users", user.email.toLowerCase());
        const snapshot = await getDoc(docRef);
        const isStaff = snapshot.exists() && snapshot.data()?.isStaff === true;
        if (active) setStaffCheck({ loading: false, isStaff });
      } catch (err) {
        if (active) setStaffCheck({ loading: false, isStaff: false });
      }
    };
    runCheck();
    return () => {
      active = false;
    };
  }, [user]);

  if (loading || staffCheck.loading) {
    return (
      <div className="portal-shell">
        <div className="portal-card">Loading admin...</div>
      </div>
    );
  }

  if (!firebaseReady) {
    return <PortalConfigMissing />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!staffCheck.isStaff) {
    return <PortalAccessDenied email={user.email} />;
  }

  return children;
};

export default StaffRoute;
