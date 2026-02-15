import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mailer";

async function listOrgAlertRecipients(orgId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      orgId,
      calendarAccessRole: { in: ["OWNER", "ADMIN"] },
    },
    select: { email: true },
  });

  return users
    .map((row) => row.email)
    .filter((email): email is string => Boolean(email && email.trim()));
}

export async function maybeSendSmsQuotaAlerts(input: {
  orgId: string;
  periodStart: Date;
  used: number;
  limit: number;
}): Promise<void> {
  if (!input.limit || input.limit <= 0) return;

  const threshold80 = Math.ceil(input.limit * 0.8);
  const now = new Date();

  if (input.used >= input.limit) {
    const updated = await prisma.organizationUsage.updateMany({
      where: {
        orgId: input.orgId,
        periodStart: input.periodStart,
        smsAlert100At: null,
        smsSentCount: { gte: input.limit },
      },
      data: { smsAlert100At: now },
    });

    if (updated.count > 0) {
      const recipients = await listOrgAlertRecipients(input.orgId);
      if (recipients.length > 0) {
        await sendEmail({
          to: recipients.join(","),
          subject: `TieGui: SMS quota limit reached (${input.used}/${input.limit})`,
          text:
            `Your workspace has reached its monthly SMS limit.\n\n` +
            `Usage: ${input.used}/${input.limit} outbound SMS this month.\n\n` +
            `Outbound texting is now blocked to prevent surprise charges.\n` +
            `If you need a higher cap, reply to this email or contact TieGui support.`,
        });
      }
    }

    return;
  }

  if (input.used >= threshold80) {
    const updated = await prisma.organizationUsage.updateMany({
      where: {
        orgId: input.orgId,
        periodStart: input.periodStart,
        smsAlert80At: null,
        smsSentCount: { gte: threshold80 },
      },
      data: { smsAlert80At: now },
    });

    if (updated.count > 0) {
      const recipients = await listOrgAlertRecipients(input.orgId);
      if (recipients.length > 0) {
        await sendEmail({
          to: recipients.join(","),
          subject: `TieGui: SMS quota at 80% (${input.used}/${input.limit})`,
          text:
            `Heads up: your workspace is nearing its monthly SMS limit.\n\n` +
            `Usage: ${input.used}/${input.limit} outbound SMS this month.\n\n` +
            `To prevent surprise charges, outbound texting will be blocked once the limit is reached.\n` +
            `If you need a higher cap, reply to this email or contact TieGui support.`,
        });
      }
    }
  }
}

export async function maybeSendAiQuotaAlerts(input: {
  orgId: string;
  periodStart: Date;
  usedCents: number;
  limitCents: number;
}): Promise<void> {
  if (!input.limitCents || input.limitCents <= 0) return;

  const threshold80 = Math.ceil(input.limitCents * 0.8);
  const now = new Date();

  if (input.usedCents >= input.limitCents) {
    const updated = await prisma.aiUsage.updateMany({
      where: {
        orgId: input.orgId,
        periodStart: input.periodStart,
        alert100At: null,
        estimatedCostCents: { gte: input.limitCents },
      },
      data: { alert100At: now },
    });

    if (updated.count > 0) {
      const recipients = await listOrgAlertRecipients(input.orgId);
      if (recipients.length > 0) {
        await sendEmail({
          to: recipients.join(","),
          subject: `TieGui: AI budget limit reached ($${(input.usedCents / 100).toFixed(2)})`,
          text:
            `Your workspace has reached its monthly AI budget.\n\n` +
            `Estimated spend: $${(input.usedCents / 100).toFixed(2)} / $${(input.limitCents / 100).toFixed(2)}\n\n` +
            `AI features may be blocked to prevent surprise charges.\n` +
            `If you need a higher cap, reply to this email or contact TieGui support.`,
        });
      }
    }

    return;
  }

  if (input.usedCents >= threshold80) {
    const updated = await prisma.aiUsage.updateMany({
      where: {
        orgId: input.orgId,
        periodStart: input.periodStart,
        alert80At: null,
        estimatedCostCents: { gte: threshold80 },
      },
      data: { alert80At: now },
    });

    if (updated.count > 0) {
      const recipients = await listOrgAlertRecipients(input.orgId);
      if (recipients.length > 0) {
        await sendEmail({
          to: recipients.join(","),
          subject: `TieGui: AI budget at 80% ($${(input.usedCents / 100).toFixed(2)})`,
          text:
            `Heads up: your workspace is nearing its monthly AI budget.\n\n` +
            `Estimated spend: $${(input.usedCents / 100).toFixed(2)} / $${(input.limitCents / 100).toFixed(2)}\n\n` +
            `AI features may be blocked once the limit is reached.\n` +
            `If you need a higher cap, reply to this email or contact TieGui support.`,
        });
      }
    }
  }
}

