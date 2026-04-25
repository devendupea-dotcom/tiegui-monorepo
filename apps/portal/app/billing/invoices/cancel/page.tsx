import Link from "next/link";

export const dynamic = "force-dynamic";

export default function InvoicePaymentCancelPage() {
  return (
    <main className="auth-shell" style={{ paddingTop: 64, paddingBottom: 64 }}>
      <section className="auth-card" style={{ maxWidth: 640 }}>
        <h1>Payment canceled</h1>
        <p className="muted" style={{ marginTop: 12 }}>
          No payment was submitted. If you still need to pay this invoice, reopen
          the payment link from the business and try again.
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
