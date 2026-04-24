import type {
  Prisma,
  RecurringBillingInterval,
  RecurringServicePlanStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { formatCurrency } from "@/lib/invoices";

export const recurringBillingIntervalOptions: RecurringBillingInterval[] = [
  "WEEK",
  "MONTH",
  "YEAR",
  "DAY",
];

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

export function isRecurringBillingInterval(
  value: string,
): value is RecurringBillingInterval {
  return recurringBillingIntervalOptions.includes(
    value as RecurringBillingInterval,
  );
}

export function formatRecurringIntervalLabel(
  interval: RecurringBillingInterval,
  intervalCount = 1,
): string {
  const safeCount = Number.isFinite(intervalCount) && intervalCount > 0
    ? Math.floor(intervalCount)
    : 1;
  const unit =
    interval === "DAY"
      ? "day"
      : interval === "WEEK"
        ? "week"
        : interval === "YEAR"
          ? "year"
          : "month";

  if (safeCount === 1) {
    return `Every ${unit}`;
  }

  return `Every ${safeCount} ${pluralize(unit, safeCount)}`;
}

export function formatRecurringChargeLabel(input: {
  amount: number | string | Prisma.Decimal;
  interval: RecurringBillingInterval;
  intervalCount?: number;
}): string {
  const intervalLabel = formatRecurringIntervalLabel(
    input.interval,
    input.intervalCount || 1,
  ).toLowerCase();
  return `${formatCurrency(input.amount)} · ${intervalLabel}`;
}

export function mapStripeSubscriptionStatus(
  status: Stripe.Subscription.Status,
): RecurringServicePlanStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "ACTIVE";
    case "past_due":
    case "paused":
    case "unpaid":
      return "PAUSED";
    case "canceled":
    case "incomplete_expired":
      return "CANCELED";
    case "incomplete":
    default:
      return "PENDING_ACTIVATION";
  }
}

export function recurringIntervalToStripe(
  interval: RecurringBillingInterval,
): Stripe.PriceCreateParams.Recurring.Interval {
  switch (interval) {
    case "DAY":
      return "day";
    case "WEEK":
      return "week";
    case "YEAR":
      return "year";
    case "MONTH":
    default:
      return "month";
  }
}

export function fromUnixSeconds(
  value: number | null | undefined,
): Date | null {
  if (!Number.isFinite(value) || !value) {
    return null;
  }
  return new Date(value * 1000);
}
