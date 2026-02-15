import nodemailer from "nodemailer";
import { Resend } from "resend";
import { normalizeEnvValue } from "./env";

const smtpUrl = normalizeEnvValue(process.env.SMTP_URL) || normalizeEnvValue(process.env.EMAIL_SERVER);
const emailFrom = normalizeEnvValue(process.env.EMAIL_FROM);
const resendApiKey = normalizeEnvValue(process.env.RESEND_API_KEY);

let transporter: nodemailer.Transporter | null = null;
let resendClient: Resend | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!smtpUrl) {
    throw new Error("SMTP is not configured (missing SMTP_URL/EMAIL_SERVER).");
  }
  if (!transporter) transporter = nodemailer.createTransport(smtpUrl);
  return transporter;
}

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

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  if (!emailFrom) {
    throw new Error("EMAIL_FROM is not configured.");
  }

  if (resendApiKey) {
    const resend = getResendClient();
    const recipients = parseRecipients(params.to);
    if (recipients.length === 0) {
      throw new Error("Email recipient list is empty.");
    }

    const result = await resend.emails.send({
      from: emailFrom,
      to: recipients,
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {}),
    });

    if (result.error) {
      throw new Error(result.error.message || "Resend failed to send email.");
    }

    return;
  }

  const transport = getTransporter();
  await transport.sendMail({
    from: emailFrom,
    to: params.to,
    subject: params.subject,
    text: params.text,
    ...(params.html ? { html: params.html } : {}),
  });
}
