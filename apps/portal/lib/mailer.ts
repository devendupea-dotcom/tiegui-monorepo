import nodemailer from "nodemailer";
import { Resend } from "resend";
import { normalizeEnvValue } from "./env";

const smtpUrl = normalizeEnvValue(process.env.SMTP_URL) || normalizeEnvValue(process.env.EMAIL_SERVER);
const smtpHost = normalizeEnvValue(process.env.SMTP_HOST);
const smtpPort = normalizeEnvValue(process.env.SMTP_PORT);
const smtpUser = normalizeEnvValue(process.env.SMTP_USER);
const smtpPass = normalizeEnvValue(process.env.SMTP_PASS);
const emailFrom = normalizeEnvValue(process.env.EMAIL_FROM);
const smtpFrom = normalizeEnvValue(process.env.SMTP_FROM);
const resendApiKey = normalizeEnvValue(process.env.RESEND_API_KEY);

let transporter: nodemailer.Transporter | null = null;
let resendClient: Resend | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!smtpUrl && !smtpHost) {
    throw new Error("SMTP is not configured (missing SMTP_URL/EMAIL_SERVER or SMTP_HOST).");
  }
  if (!transporter) {
    if (smtpUrl) {
      transporter = nodemailer.createTransport(smtpUrl);
    } else {
      const parsedPort = Number(smtpPort || "587");
      const port = Number.isFinite(parsedPort) ? parsedPort : 587;
      transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure: port === 465,
        ...(smtpUser || smtpPass
          ? {
              auth: {
                user: smtpUser || "",
                pass: smtpPass || "",
              },
            }
          : {}),
      });
    }
  }
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

function resolveFromAddress(from?: string): string {
  const resolved = normalizeEnvValue(from) || smtpFrom || emailFrom;
  if (!resolved) {
    throw new Error("EMAIL_FROM/SMTP_FROM is not configured.");
  }
  return resolved;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
  attachments?: nodemailer.SendMailOptions["attachments"];
}): Promise<void> {
  const from = resolveFromAddress(params.from);

  if (resendApiKey && !params.attachments?.length) {
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
    });

    if (result.error) {
      throw new Error(result.error.message || "Resend failed to send email.");
    }

    return;
  }

  const transport = getTransporter();
  await transport.sendMail({
    from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    ...(params.html ? { html: params.html } : {}),
    ...(params.attachments?.length ? { attachments: params.attachments } : {}),
  });
}
