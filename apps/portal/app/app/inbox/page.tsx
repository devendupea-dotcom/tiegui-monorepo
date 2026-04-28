import { prisma } from "@/lib/prisma";
import {
  canComposeManualSms,
  resolveTwilioMessagingReadiness,
} from "@/lib/twilio-readiness";
import { getParam, resolveAppScope } from "../_lib/portal-scope";
import { requireAppPageViewer } from "../_lib/portal-viewer";
import UnifiedInbox from "./unified-inbox";

export const dynamic = "force-dynamic";

export default async function ClientInboxPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const requestedOrgId = getParam(searchParams?.orgId);
  const requestedLeadId = getParam(searchParams?.leadId);
  const requestedContext = getParam(searchParams?.context);
  const scope = await resolveAppScope({ nextPath: "/app/inbox", requestedOrgId });
  const viewer = await requireAppPageViewer({
    nextPath: "/app/inbox",
    orgId: scope.orgId,
  });
  const canManage = viewer.internalUser || viewer.calendarAccessRole !== "READ_ONLY";
  const organization = await prisma.organization.findUnique({
    where: { id: scope.orgId },
    select: {
      twilioConfig: {
        select: {
          phoneNumber: true,
          status: true,
        },
      },
    },
  });
  const messagingReadiness = resolveTwilioMessagingReadiness({
    twilioConfig: organization?.twilioConfig || null,
  });

  return (
    <UnifiedInbox
      orgId={scope.orgId}
      internalUser={viewer.internalUser}
      onboardingComplete={scope.onboardingComplete}
      canManage={canManage}
      messagingReadinessCode={messagingReadiness.code}
      canComposeMessages={canComposeManualSms(messagingReadiness.code)}
      initialLeadId={requestedLeadId}
      initialOpenContextEditor={requestedContext === "edit"}
    />
  );
}
