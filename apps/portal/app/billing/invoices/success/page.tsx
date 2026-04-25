import Link from "next/link";

export const dynamic = "force-dynamic";

export default function InvoicePaymentSuccessPage() {
  return (
    <main className="auth-shell" style={{ paddingTop: 64, paddingBottom: 64 }}>
      <section className="auth-card" style={{ maxWidth: 640 }}>
        <h1>Payment received</h1>
        <p className="muted" style={{ marginTop: 12 }}>
          Thanks. Your card payment was submitted successfully and the business
          will see it on the invoice shortly.
        </p>
        <p className="muted" style={{ marginTop: 12 }}>
          You can close this page now if you were sent here from a payment link.
        </p>
        <div className="quick-links" style={{ marginTop: 20 }}>
          <Link className="btn secondary" href="/">
            Back to Home
          </Link>
        </div>
      </section>
    </main>
  );
}
