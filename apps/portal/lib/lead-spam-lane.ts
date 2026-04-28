export function shouldRouteLeadToSpamReview(input: {
  potentialSpam?: boolean | null;
  potentialSpamSignals?: readonly unknown[] | null;
  failedOutboundCount?: number | null;
}): boolean {
  if (input.potentialSpam) {
    return true;
  }

  if ((input.potentialSpamSignals?.length || 0) > 0) {
    return true;
  }

  return (input.failedOutboundCount || 0) > 0;
}
