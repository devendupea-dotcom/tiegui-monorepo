import { Resend, type Attachment } from "resend";
import { normalizeEnvValue } from "./env";

const emailFrom = normalizeEnvValue(process.env.EMAIL_FROM);
const resendFrom = normalizeEnvValue(process.env.RESEND_FROM);
const resendApiKey = normalizeEnvValue(process.env.RESEND_API_KEY);

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }
  if (!resendClient) {
    resendClient = new Resend(resendApiKey);
  }
  return resendClient;
}

function parseRecipients(to: string): string[] {
  return to
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function resolveFromAddress(from?: string): string {
  const resolved = normalizeEnvValue(from) || resendFrom || emailFrom;
  if (!resolved) {
    throw new Error("EMAIL_FROM/RESEND_FROM is not configured.");
  }
  return resolved;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
  attachments?: Attachment[];
}): Promise<void> {
  const from = resolveFromAddress(params.from);
  const resend = getResendClient();
  const recipients = parseRecipients(params.to);
  if (recipients.length === 0) {
    throw new Error("Email recipient list is empty.");
  }

  const result = await resend.emails.send({
    from,
    to: recipients,
    subject: params.subject,
    text: params.text,
    ...(params.html ? { html: params.html } : {}),
    ...(params.attachments?.length ? { attachments: params.attachments } : {}),
  });

  if (result.error) {
    throw new Error(result.error.message || "Resend failed to send email.");
  }
}
