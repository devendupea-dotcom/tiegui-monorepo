import { useState } from "react";
import { Link } from "react-router-dom";

const REQUEST_ACCESS_ENDPOINT =
  import.meta.env.VITE_REQUEST_ACCESS_ENDPOINT || "https://formspree.io/f/your-form-id";

const RequestAccess = () => {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setStatus("submitting");

    if (REQUEST_ACCESS_ENDPOINT.includes("your-form-id")) {
      setStatus("idle");
      setError("Request form is not configured yet.");
      return;
    }

    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch(REQUEST_ACCESS_ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: formData,
      });
      if (!response.ok) {
        throw new Error("Form submission failed.");
      }
      setStatus("success");
      event.currentTarget.reset();
    } catch (err) {
      setStatus("idle");
      setError(err?.message || "Could not send request.");
    }
  };

  return (
    <div className="portal-shell">
      <div className="portal-card request-card">
        <div className="portal-header">
          <div className="portal-title">Request portal access</div>
          <div className="portal-sub">We will follow up to confirm details.</div>
        </div>

        {status === "success" ? (
          <div className="request-success">
            Thanks — your request was sent. We will reach out soon.
          </div>
        ) : (
          <form className="portal-form request-form" onSubmit={handleSubmit}>
            <div className="request-grid">
              <label>
                Name
                <input name="name" required />
              </label>
              <label>
                Business
                <input name="business" required />
              </label>
              <label>
                Email
                <input name="email" type="email" required />
              </label>
              <label>
                Phone
                <input name="phone" />
              </label>
              <label>
                City / State
                <input name="location" />
              </label>
            </div>
            <label>
              Notes
              <textarea name="notes" rows="4" />
            </label>
            {error && <div className="portal-error">{error}</div>}
            <button className="btn primary full" type="submit" disabled={status === "submitting"}>
              {status === "submitting" ? "Sending..." : "Send request"}
            </button>
          </form>
        )}

        <div className="portal-back">
          <Link to="/login">Back to login</Link>
        </div>
      </div>
    </div>
  );
};

export default RequestAccess;
