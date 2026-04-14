import Link from "next/link";
import { getRequestTranslator } from "@/lib/i18n";
import { withOrgQuery } from "./_lib/portal-scope";
import { PanelCard } from "./dashboard-ui";

type WorkflowGuidanceCardProps = {
  orgId: string;
  internalUser: boolean;
};

const steps = [
  {
    titleKey: "dashboard.workflow.steps.capture.title",
    detailKey: "dashboard.workflow.steps.capture.detail",
    href: "/app/jobs",
    actionKey: "dashboard.workflow.steps.capture.action",
  },
  {
    titleKey: "dashboard.workflow.steps.reply.title",
    detailKey: "dashboard.workflow.steps.reply.detail",
    href: "/app/inbox",
    actionKey: "dashboard.workflow.steps.reply.action",
  },
  {
    titleKey: "dashboard.workflow.steps.estimate.title",
    detailKey: "dashboard.workflow.steps.estimate.detail",
    href: "/app/estimates",
    actionKey: "dashboard.workflow.steps.estimate.action",
  },
  {
    titleKey: "dashboard.workflow.steps.schedule.title",
    detailKey: "dashboard.workflow.steps.schedule.detail",
    href: "/app/calendar?quickAction=schedule",
    actionKey: "dashboard.workflow.steps.schedule.action",
  },
  {
    titleKey: "dashboard.workflow.steps.invoice.title",
    detailKey: "dashboard.workflow.steps.invoice.detail",
    href: "/app/invoices",
    actionKey: "dashboard.workflow.steps.invoice.action",
  },
];

export default async function WorkflowGuidanceCard({ orgId, internalUser }: WorkflowGuidanceCardProps) {
  const t = await getRequestTranslator();

  return (
    <PanelCard
      eyebrow={t("dashboard.workflow.eyebrow")}
      title={t("dashboard.workflow.title")}
      subtitle={t("dashboard.workflow.subtitle")}
      actionHref={withOrgQuery("/app/jobs", orgId, internalUser)}
      actionLabel={t("dashboard.workflow.action")}
    >
      <ul className="dashboard-list">
        {steps.map((step, index) => (
          <li key={step.titleKey} className="dashboard-list-row">
            <div className="dashboard-list-primary">
              <strong>
                {index + 1}. {t(step.titleKey)}
              </strong>
              <div className="dashboard-list-meta">
                <span>{t(step.detailKey)}</span>
              </div>
            </div>
            <Link className="table-link" href={withOrgQuery(step.href, orgId, internalUser)} prefetch={false}>
              {t(step.actionKey)}
            </Link>
          </li>
        ))}
      </ul>
    </PanelCard>
  );
}
