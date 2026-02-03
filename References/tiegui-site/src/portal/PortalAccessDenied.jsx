import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";

const PortalAccessDenied = ({ email }) => {
  return (
    <div className="portal-shell">
      <div className="portal-card">
        <h2>Access denied</h2>
        <p className="muted">
          {email || "This account"} is not authorized for the Tiegui Portal.
        </p>
        <button className="btn primary" type="button" onClick={() => signOut(auth)}>
          Sign out
        </button>
      </div>
    </div>
  );
};

export default PortalAccessDenied;
