import nodemailer from "nodemailer";
import { normalizeEnvValue } from "./env";

const smtpUrl = normalizeEnvValue(process.env.SMTP_URL) || normalizeEnvValue(process.env.EMAIL_SERVER);
const emailFrom = normalizeEnvValue(process.env.EMAIL_FROM);

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!smtpUrl) {
    throw new Error("SMTP is not configured (missing SMTP_URL/EMAIL_SERVER).");
  }
  if (!transporter) transporter = nodemailer.createTransport(smtpUrl);
  return transporter;
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

  const transport = getTransporter();
  await transport.sendMail({
    from: emailFrom,
    to: params.to,
    subject: params.subject,
    text: params.text,
    ...(params.html ? { html: params.html } : {}),
  });
}

