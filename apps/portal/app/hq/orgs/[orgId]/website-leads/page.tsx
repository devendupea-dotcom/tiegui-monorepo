import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireInternalUser } from "@/lib/session";
import {
  listWebsiteLeadSources,
  listWebsiteLeadSubmissionReceipts,
} from "@/lib/website-lead-sources";
import WebsiteLeadSourcesManager from "./website-lead-sources-manager";

export const dynamic = "force-dynamic";

export default async function HqWebsiteLeadSourcesPage(
  props: {
    params: Promise<{ orgId: string }>;
  },
) {
  const params = await props.params;
  await requireInternalUser(`/hq/orgs/${params.orgId}/website-leads`);

  const [organization, sources, recentReceipts] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: params.orgId },
      select: { id: true, name: true },
    }),
    listWebsiteLeadSources(params.orgId),
    listWebsiteLeadSubmissionReceipts({ orgId: params.orgId, take: 25 }),
  ]);

  if (!organization) {
    notFound();
  }

  return (
    <>
      <section className="card">
        <Link href={`/hq/businesses/${organization.id}`} className="table-link">
          &larr; Business folder
        </Link>
        <h2 style={{ marginTop: 8 }}>Website Lead Sources</h2>
        <p className="muted">
          Internal setup for signed website lead intake on {organization.name}.
        </p>
      </section>

      <WebsiteLeadSourcesManager
        orgId={organization.id}
        orgName={organization.name}
        initialSources={sources}
        initialReceipts={recentReceipts}
      />
    </>
  );
}
