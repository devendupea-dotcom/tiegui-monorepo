import CustomerEstimateView from "./customer-estimate-view";
import { AppApiError } from "@/lib/app-api-permissions";
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
}: {
  params: {
    token: string;
  };
}) {
  try {
    const estimate = await getEstimateShareByToken(params.token);
    return <CustomerEstimateView token={params.token} initialEstimate={estimate} initialError={null} />;
  } catch (error) {
    const message =
      error instanceof AppApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "This estimate link is invalid, expired, or has been revoked.";
    return <CustomerEstimateView token={params.token} initialEstimate={null} initialError={message} />;
  }
}
