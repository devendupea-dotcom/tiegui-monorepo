import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function RecurringBillingSuccessPage(
  props: {
    params: Promise<{
      planId: string;
    }>;
  }
) {
  const params = await props.params;
  const plan = await prisma.recurringServicePlan.findUnique({
    where: { id: params.planId },
    select: {
      name: true,
      customer: {
        select: {
          name: true,
        },
      },
      org: {
        select: {
          name: true,
          phone: true,
          email: true,
          website: true,
        },
      },
    },
  });

  return (
    <main className="estimate-share-page tracking-page">
      <section className="card estimate-share-card">
        <div className="portal-empty-state tracking-empty-state">
          <strong>Recurring billing setup complete</strong>
          <p className="muted">
            {plan
              ? `${plan.org.name} received your subscription signup for ${plan.name}.`
              : "Your subscription signup was received."}
          </p>
          {plan ? (
            <div className="stack-cell" style={{ marginTop: 12 }}>
              <span>{plan.customer.name}</span>
              {plan.org.phone ? <span>{plan.org.phone}</span> : null}
              {plan.org.email ? <span>{plan.org.email}</span> : null}
              {plan.org.website ? (
                <a href={plan.org.website} target="_blank" rel="noreferrer">
                  {plan.org.website}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
