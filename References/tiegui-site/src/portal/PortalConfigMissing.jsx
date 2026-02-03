import { firebaseConfigMissing } from "../lib/firebase";

const PortalConfigMissing = () => {
  return (
    <div className="portal-shell">
      <div className="portal-card">
        <h2>Portal not configured</h2>
        <p className="muted">
          Add Firebase env vars to <code>.env</code> before using the portal.
        </p>
        <div className="portal-missing">
          Missing: {firebaseConfigMissing.join(", ")}
        </div>
      </div>
    </div>
  );
};

export default PortalConfigMissing;
