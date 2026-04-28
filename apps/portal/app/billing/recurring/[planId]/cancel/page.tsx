import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function RecurringBillingCancelPage(
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
      org: {
        select: {
          name: true,
          phone: true,
          email: true,
        },
      },
    },
  });

  return (
    <main className="estimate-share-page tracking-page">
      <section className="card estimate-share-card">
        <div className="portal-empty-state tracking-empty-state">
          <strong>Checkout canceled</strong>
          <p className="muted">
            {plan
              ? `No subscription was started for ${plan.name}. You can reach back out to ${plan.org.name} when you are ready.`
              : "No subscription was started."}
          </p>
          {plan?.org.phone ? <p className="muted">{plan.org.phone}</p> : null}
          {plan?.org.email ? <p className="muted">{plan.org.email}</p> : null}
        </div>
      </section>
    </main>
  );
}
