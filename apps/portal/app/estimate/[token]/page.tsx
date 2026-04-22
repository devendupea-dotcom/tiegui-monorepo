import { getServerSession } from "next-auth";
import CustomerEstimateView from "./customer-estimate-view";
import { AppApiError } from "@/lib/app-api-permissions";
import { authOptions } from "@/lib/auth";
import { getEstimateShareByToken } from "@/lib/estimate-share-store";

export const dynamic = "force-dynamic";
export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function EstimateSharePage({
  params,
  searchParams,
}: {
  params: {
    token: string;
  };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const previewParam = Array.isArray(searchParams?.preview)
    ? searchParams?.preview[0]
    : searchParams?.preview;
  const previewRequested = previewParam === "1";
  const session = previewRequested ? await getServerSession(authOptions) : null;
  const previewMode = previewRequested && Boolean(session);

  try {
    const estimate = await getEstimateShareByToken(params.token);
    return (
      <CustomerEstimateView
        token={params.token}
        initialEstimate={estimate}
        initialError={null}
        previewMode={previewMode}
      />
    );
  } catch (error) {
    const message =
      error instanceof AppApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "This estimate link is invalid, expired, or has been revoked.";
    return (
      <CustomerEstimateView
        token={params.token}
        initialEstimate={null}
        initialError={message}
        previewMode={previewMode}
      />
    );
  }
}
