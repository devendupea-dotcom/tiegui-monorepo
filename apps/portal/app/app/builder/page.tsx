import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  formatBuyerProjectStageLabel,
  formatBuyerProjectTypeLabel,
} from "@/lib/buyer-projects";
import {
  changeOrderStatusOptions,
  contractProjectStatusOptions,
  createContractProjectFromBuyerProject,
  formatChangeOrderStatusLabel,
  formatContractProjectStatusLabel,
  formatPaymentMilestoneStatusLabel,
  paymentMilestoneStatusOptions,
  updateContractProject,
} from "@/lib/contract-projects";
import { prisma } from "@/lib/prisma";
import {
  getParam,
  requireAppOrgActor,
  resolveAppScope,
  withOrgQuery,
} from "../_lib/portal-scope";
import { requireAppPageViewer } from "../_lib/portal-viewer";
import BuyerProjectTrackingLinkButton from "./buyer-project-tracking-link-button";

export const dynamic = "force-dynamic";

type BuilderPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrencyFromCents(value: number | null): string {
  if (value === null) {
    return "Deposit amount pending";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

async function startContractProject(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  const buyerProjectId = String(formData.get("buyerProjectId") || "").trim();
  const actor = await requireAppOrgActor("/app/builder", orgId);

  if (!actor.internalUser && actor.calendarAccessRole === "READ_ONLY") {
    throw new Error("Read-only users cannot start contract projects.");
  }

  await createContractProjectFromBuyerProject({
    orgId,
    buyerProjectId,
    actorId: actor.id,
  });

  revalidatePath("/app/builder");
}

async function saveContractProject(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  const contractProjectId = String(formData.get("contractProjectId") || "").trim();
  const actor = await requireAppOrgActor("/app/builder", orgId);

  if (!actor.internalUser && actor.calendarAccessRole === "READ_ONLY") {
    throw new Error("Read-only users cannot update contract projects.");
  }

  await updateContractProject({
    orgId,
    contractProjectId,
    contractStatus: String(formData.get("contractStatus") || ""),
    changeOrderStatus: String(formData.get("changeOrderStatus") || ""),
    paymentStatus: String(formData.get("paymentStatus") || ""),
    contractDocumentUrl: String(formData.get("contractDocumentUrl") || ""),
    contractDocumentLabel: String(formData.get("contractDocumentLabel") || ""),
    depositDueDollars: String(formData.get("depositDueDollars") || ""),
  });

  revalidatePath("/app/builder");
}

async function saveBuyerProjectCustomerUpdate(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") || "").trim();
  const buyerProjectId = String(formData.get("buyerProjectId") || "").trim();
  const buyerNextStep = String(formData.get("buyerNextStep") || "").trim().slice(0, 700);
  const publicNotes = String(formData.get("publicNotes") || "").trim().slice(0, 1200);
  const actor = await requireAppOrgActor("/app/builder", orgId);

  if (!actor.internalUser && actor.calendarAccessRole === "READ_ONLY") {
    throw new Error("Read-only users cannot update customer-facing project notes.");
  }

  const updated = await prisma.buyerProject.updateMany({
    where: {
      id: buyerProjectId,
      orgId,
    },
    data: {
      buyerNextStep: buyerNextStep || null,
      publicNotes: publicNotes || null,
    },
  });

  if (updated.count === 0) {
    throw new Error("Buyer project not found.");
  }

  revalidatePath("/app/builder");
}

export default async function BuilderPortalPage({ searchParams }: BuilderPageProps) {
  const params = await searchParams;
  const requestedOrgId = getParam(params?.orgId);
  const scope = await resolveAppScope({
    nextPath: "/app/builder",
    requestedOrgId,
  });
  await requireAppPageViewer({
    nextPath: "/app/builder",
    orgId: scope.orgId,
  });

  const organization = await prisma.organization.findUnique({
    where: { id: scope.orgId },
    select: {
      id: true,
      name: true,
      portalVertical: true,
      website: true,
      phone: true,
      email: true,
    },
  });

  if (!organization) {
    redirect("/app");
  }

  if (organization.portalVertical !== "HOMEBUILDER") {
    redirect(withOrgQuery("/app", scope.orgId, scope.internalUser));
  }

  const [
    activeBuildsCount,
    trackingLinksCount,
    pendingChangesCount,
    buyerProjectsCount,
    activeContractProjectsCount,
    recentBuyerProjects,
    activeContractProjects,
  ] = await Promise.all([
    prisma.job.count({
      where: {
        orgId: scope.orgId,
        status: { in: ["DRAFT", "ESTIMATING", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"] },
      },
    }),
    prisma.jobTrackingLink.count({
      where: {
        orgId: scope.orgId,
        revokedAt: null,
      },
    }),
    prisma.estimate.count({
      where: {
        orgId: scope.orgId,
        status: { in: ["DRAFT", "SENT"] },
      },
    }),
    prisma.buyerProject.count({ where: { orgId: scope.orgId } }),
    prisma.contractProject.count({
      where: {
        orgId: scope.orgId,
        contractStatus: { not: "COMPLETE" },
      },
    }),
    prisma.buyerProject.findMany({
      where: { orgId: scope.orgId },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: {
        id: true,
        projectName: true,
        buyerName: true,
        projectType: true,
        currentStage: true,
        selectedHomeTitle: true,
        selectedHomeType: true,
        selectedHomePriceLabel: true,
        budgetRange: true,
        financingStatus: true,
        landStatus: true,
        timeline: true,
        buyerNextStep: true,
        publicNotes: true,
        smsOptIn: true,
        updatedAt: true,
        leadId: true,
        contractProject: {
          select: {
            id: true,
            contractStatus: true,
          },
        },
      },
    }),
    prisma.contractProject.findMany({
      where: {
        orgId: scope.orgId,
        contractStatus: { not: "COMPLETE" },
      },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: {
        id: true,
        contractStatus: true,
        changeOrderStatus: true,
        paymentStatus: true,
        contractDocumentUrl: true,
          contractDocumentLabel: true,
          depositDueCents: true,
          depositPaidAt: true,
          contractSignedAt: true,
          activeStartedAt: true,
          completedAt: true,
          internalNextStep: true,
          updatedAt: true,
        buyerProject: {
          select: {
            id: true,
            projectName: true,
            buyerName: true,
            projectType: true,
            currentStage: true,
            selectedHomeTitle: true,
            selectedHomeType: true,
            selectedHomePriceLabel: true,
            budgetRange: true,
            financingStatus: true,
            landStatus: true,
            timeline: true,
            buyerNextStep: true,
            publicNotes: true,
            smsOptIn: true,
            leadId: true,
          },
        },
      },
    }),
  ]);

  const cards = [
    {
      title: "Buyer Pipeline",
      body: "Work new website inquiries, land-fit questions, financing conversations, and active buyer handoffs.",
      href: "/app/jobs",
      action: "Open Buyers",
    },
    {
      title: "Build Projects",
      body: "Manage each active home project, timeline, dispatch status, notes, photos, and customer update link.",
      href: "/app/jobs/records",
      action: "Open Projects",
    },
    {
      title: "Build Schedule",
      body: "Coordinate planning calls, delivery windows, setup work, walkthroughs, and follow-up appointments.",
      href: "/app/dispatch",
      action: "Open Schedule",
    },
    {
      title: "Estimates",
      body: "Use estimates for buyer-facing pricing, upgrade approvals, allowances, and project scope decisions.",
      href: "/app/estimates",
      action: "Open Estimates",
    },
  ] as const;

  return (
    <section className="stack-page">
      <div className="dashboard-hero">
        <div>
          <p className="section-kicker">Builder Portal</p>
          <h1>{organization.name}</h1>
          <p className="muted">
            A homebuilder workspace for buyers, build projects, private update
            links, estimates, and communication.
          </p>
        </div>
        <div className="portal-empty-actions">
          <Link className="btn primary" href={withOrgQuery("/app/jobs?openOnly=1", scope.orgId, scope.internalUser)}>
            Work Buyers
          </Link>
          <Link className="btn secondary" href={withOrgQuery("/app/jobs/records", scope.orgId, scope.internalUser)}>
            View Builds
          </Link>
        </div>
      </div>

      <div className="stat-grid">
        <article className="stat-card">
          <span>Buyer projects</span>
          <strong>{formatCount(buyerProjectsCount)}</strong>
        </article>
        <article className="stat-card">
          <span>Active contracts</span>
          <strong>{formatCount(activeContractProjectsCount)}</strong>
        </article>
        <article className="stat-card">
          <span>Active builds</span>
          <strong>{formatCount(activeBuildsCount)}</strong>
        </article>
        <article className="stat-card">
          <span>Live update links</span>
          <strong>{formatCount(trackingLinksCount)}</strong>
        </article>
        <article className="stat-card">
          <span>Draft / sent changes</span>
          <strong>{formatCount(pendingChangesCount)}</strong>
        </article>
      </div>

      <article className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <strong>Endeavor Contract Projects</strong>
            <p className="muted">
              Buyer projects can move into active contract work without losing
              the selected home, budget, financing, land-fit, or buyer journey
              context that came from the Endeavor website.
            </p>
          </div>
          <Link className="btn secondary" href={withOrgQuery("/app/estimates", scope.orgId, scope.internalUser)}>
            Manage Changes
          </Link>
        </div>

        {activeContractProjects.length > 0 ? (
          <div className="grid two-col">
            {activeContractProjects.map((contract) => (
              <article key={contract.id} className="estimate-share-panel">
                <div className="stack-cell">
                  <div className="invoice-header-row">
                    <div className="stack-cell">
                      <span className="badge status-running">
                        {formatContractProjectStatusLabel(contract.contractStatus)}
                      </span>
                      <strong>{contract.buyerProject.projectName}</strong>
                      <span className="muted">
                        {formatBuyerProjectTypeLabel(contract.buyerProject.projectType)}
                        {contract.buyerProject.smsOptIn ? " | SMS opted in" : ""}
                      </span>
                    </div>
                    <div className="portal-empty-actions">
                      <BuyerProjectTrackingLinkButton buyerProjectId={contract.buyerProject.id} />
                      {contract.buyerProject.leadId ? (
                        <>
                        <Link
                          className="btn secondary"
                          href={withOrgQuery(
                            `/app/inbox?leadId=${encodeURIComponent(contract.buyerProject.leadId)}`,
                            scope.orgId,
                            scope.internalUser,
                          )}
                        >
                          Open Twilio Thread
                        </Link>
                        <Link
                          className="btn secondary"
                          href={withOrgQuery(`/app/jobs/${contract.buyerProject.leadId}`, scope.orgId, scope.internalUser)}
                        >
                          Open Lead
                        </Link>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="estimate-share-meta-grid">
                    <div className="stack-cell">
                      <span className="muted">Contract</span>
                      <strong>
                        {contract.contractDocumentUrl ? (
                          <a href={contract.contractDocumentUrl} target="_blank" rel="noreferrer">
                            {contract.contractDocumentLabel || "Open Contract"}
                          </a>
                        ) : (
                          "Document link pending"
                        )}
                      </strong>
                      <span>{contract.contractSignedAt ? "Signed" : "Signature pending"}</span>
                    </div>
                    <div className="stack-cell">
                      <span className="muted">Deposit / Payments</span>
                      <strong>{formatPaymentMilestoneStatusLabel(contract.paymentStatus)}</strong>
                      <span>{formatCurrencyFromCents(contract.depositDueCents)}</span>
                      <span>{contract.depositPaidAt ? "Deposit received" : "Deposit not marked paid"}</span>
                    </div>
                    <div className="stack-cell">
                      <span className="muted">Estimates</span>
                      <strong>{formatChangeOrderStatusLabel(contract.changeOrderStatus)}</strong>
                      <span>{contract.activeStartedAt ? "Active build started" : "Awaiting active build start"}</span>
                    </div>
                    <div className="stack-cell">
                      <span className="muted">Selected Home</span>
                      <strong>{contract.buyerProject.selectedHomeTitle || "Home to confirm"}</strong>
                      <span>
                        {contract.buyerProject.selectedHomeType ||
                          contract.buyerProject.selectedHomePriceLabel ||
                          "Context pending"}
                      </span>
                    </div>
                    <div className="stack-cell">
                      <span className="muted">Buyer Journey</span>
                      <strong>{formatBuyerProjectStageLabel(contract.buyerProject.currentStage)}</strong>
                      <span>{contract.buyerProject.budgetRange || "Budget pending"}</span>
                      <span>{contract.buyerProject.financingStatus || "Financing pending"}</span>
                      <span>{contract.buyerProject.landStatus || "Land status pending"}</span>
                    </div>
                  </div>

                  <form action={saveContractProject} className="estimate-share-section">
                    <input type="hidden" name="orgId" value={scope.orgId} />
                    <input type="hidden" name="contractProjectId" value={contract.id} />
                    <div className="estimate-share-meta-grid">
                      <label className="stack-cell">
                        <span className="muted">Contract Status</span>
                        <select name="contractStatus" defaultValue={contract.contractStatus}>
                          {contractProjectStatusOptions.map((status) => (
                            <option key={status} value={status}>
                              {formatContractProjectStatusLabel(status)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="stack-cell">
                        <span className="muted">Payment Status</span>
                        <select name="paymentStatus" defaultValue={contract.paymentStatus}>
                          {paymentMilestoneStatusOptions.map((status) => (
                            <option key={status} value={status}>
                              {formatPaymentMilestoneStatusLabel(status)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="stack-cell">
                        <span className="muted">Change Order Status</span>
                        <select name="changeOrderStatus" defaultValue={contract.changeOrderStatus}>
                          {changeOrderStatusOptions.map((status) => (
                            <option key={status} value={status}>
                              {formatChangeOrderStatusLabel(status)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="stack-cell">
                        <span className="muted">Contract Link</span>
                        <input
                          name="contractDocumentUrl"
                          type="url"
                          defaultValue={contract.contractDocumentUrl || ""}
                          placeholder="https://..."
                        />
                      </label>
                      <label className="stack-cell">
                        <span className="muted">Document Label</span>
                        <input
                          name="contractDocumentLabel"
                          type="text"
                          defaultValue={contract.contractDocumentLabel || ""}
                          placeholder="Signed contract"
                        />
                      </label>
                      <label className="stack-cell">
                        <span className="muted">Deposit Due</span>
                        <input
                          name="depositDueDollars"
                          type="text"
                          inputMode="decimal"
                          defaultValue={contract.depositDueCents === null ? "" : String(contract.depositDueCents / 100)}
                          placeholder="$5,000"
                        />
                      </label>
                    </div>
                    <button className="btn secondary" type="submit">
                      Save Contract
                    </button>
                  </form>

                  <form action={saveBuyerProjectCustomerUpdate} className="estimate-share-section">
                    <input type="hidden" name="orgId" value={scope.orgId} />
                    <input type="hidden" name="buyerProjectId" value={contract.buyerProject.id} />
                    <label className="stack-cell">
                      <span className="muted">Customer Next Step</span>
                      <textarea
                        name="buyerNextStep"
                        rows={2}
                        defaultValue={contract.buyerProject.buyerNextStep || ""}
                        placeholder="What should the buyer expect or do next?"
                      />
                    </label>
                    <label className="stack-cell">
                      <span className="muted">Latest Customer Update</span>
                      <textarea
                        name="publicNotes"
                        rows={3}
                        defaultValue={contract.buyerProject.publicNotes || ""}
                        placeholder="Write the update that should appear in the customer project room."
                      />
                    </label>
                    <button className="btn secondary" type="submit">
                      Save Customer Update
                    </button>
                  </form>

                  {contract.internalNextStep ? (
                    <p className="muted">{contract.internalNextStep}</p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="portal-empty-state">
            <strong>No active contract projects yet.</strong>
            <p className="muted">
              Start a contract from a buyer project once Endeavor is ready to
              send paperwork, collect deposit, and move into active build work.
            </p>
          </div>
        )}
      </article>

      <article className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <strong>Endeavor Buyer Projects</strong>
            <p className="muted">
              Website inquiries become buyer projects with the selected home,
              budget, financing, land-fit status, timeline, and current home
              journey stage already attached.
            </p>
          </div>
          <Link className="btn secondary" href={withOrgQuery("/app/jobs", scope.orgId, scope.internalUser)}>
            Work Pipeline
          </Link>
        </div>

        {recentBuyerProjects.length > 0 ? (
          <div className="grid two-col">
            {recentBuyerProjects.map((project) => (
              <article key={project.id} className="estimate-share-panel">
                <div className="stack-cell">
                  <div className="invoice-header-row">
                    <div className="stack-cell">
                      <span className="badge status-running">
                        {formatBuyerProjectStageLabel(project.currentStage)}
                      </span>
                      <strong>{project.projectName}</strong>
                      <span className="muted">
                        {formatBuyerProjectTypeLabel(project.projectType)}
                        {project.smsOptIn ? " | SMS opted in" : ""}
                      </span>
                    </div>
                    <div className="portal-empty-actions">
                      <BuyerProjectTrackingLinkButton buyerProjectId={project.id} />
                      {project.contractProject ? (
                        <span className="badge status-running">
                          Contract: {formatContractProjectStatusLabel(project.contractProject.contractStatus)}
                        </span>
                      ) : (
                        <form action={startContractProject}>
                          <input type="hidden" name="orgId" value={scope.orgId} />
                          <input type="hidden" name="buyerProjectId" value={project.id} />
                          <button className="btn primary" type="submit">
                            Start Contract
                          </button>
                        </form>
                      )}
                      {project.leadId ? (
                        <>
                          <Link
                            className="btn secondary"
                            href={withOrgQuery(
                              `/app/inbox?leadId=${encodeURIComponent(project.leadId)}`,
                              scope.orgId,
                              scope.internalUser,
                            )}
                          >
                            Open Twilio Thread
                          </Link>
                          <Link
                            className="btn secondary"
                            href={withOrgQuery(`/app/jobs/${project.leadId}`, scope.orgId, scope.internalUser)}
                          >
                            Open Lead
                          </Link>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="estimate-share-meta-grid">
                    <div className="stack-cell">
                      <span className="muted">Buyer</span>
                      <strong>{project.buyerName}</strong>
                      <span>{project.timeline || "Timeline pending"}</span>
                    </div>
                    <div className="stack-cell">
                      <span className="muted">Selected Home</span>
                      <strong>{project.selectedHomeTitle || "Home to confirm"}</strong>
                      <span>{project.selectedHomeType || project.selectedHomePriceLabel || "Context pending"}</span>
                    </div>
                    <div className="stack-cell">
                      <span className="muted">Budget / Site</span>
                      <strong>{project.budgetRange || "Budget pending"}</strong>
                      <span>{project.financingStatus || "Financing pending"}</span>
                      <span>{project.landStatus || "Land status pending"}</span>
                    </div>
                  </div>

                  {project.buyerNextStep ? (
                    <p className="muted">{project.buyerNextStep}</p>
                  ) : null}

                  <form action={saveBuyerProjectCustomerUpdate} className="estimate-share-section">
                    <input type="hidden" name="orgId" value={scope.orgId} />
                    <input type="hidden" name="buyerProjectId" value={project.id} />
                    <label className="stack-cell">
                      <span className="muted">Customer Next Step</span>
                      <textarea
                        name="buyerNextStep"
                        rows={2}
                        defaultValue={project.buyerNextStep || ""}
                        placeholder="What should the buyer expect or do next?"
                      />
                    </label>
                    <label className="stack-cell">
                      <span className="muted">Latest Customer Update</span>
                      <textarea
                        name="publicNotes"
                        rows={3}
                        defaultValue={project.publicNotes || ""}
                        placeholder="Write the update that should appear in the customer project room."
                      />
                    </label>
                    <button className="btn secondary" type="submit">
                      Save Customer Update
                    </button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="portal-empty-state">
            <strong>No buyer projects yet.</strong>
            <p className="muted">
              New Endeavor website inquiries will create buyer projects here
              automatically once the website lead source is connected.
            </p>
          </div>
        )}
      </article>

      <div className="grid two-col">
        {cards.map((card) => (
          <article key={card.href} className="card">
            <div className="stack-cell">
              <strong>{card.title}</strong>
              <p className="muted">{card.body}</p>
            </div>
            <Link className="btn secondary" href={withOrgQuery(card.href, scope.orgId, scope.internalUser)}>
              {card.action}
            </Link>
          </article>
        ))}
      </div>

      <article className="card">
        <div className="invoice-header-row">
          <div className="stack-cell">
            <strong>Customer project access</strong>
            <p className="muted">
              For v1, Endeavor can generate secure private tracking links from
              each build project and send them by SMS. Customer account records
              are isolated in the data model so a later buyer login on the
              Endeavor site can be added without exposing the internal workspace.
            </p>
          </div>
          <Link className="btn primary" href={withOrgQuery("/app/dispatch", scope.orgId, scope.internalUser)}>
            Generate Links
          </Link>
        </div>
      </article>
    </section>
  );
}
