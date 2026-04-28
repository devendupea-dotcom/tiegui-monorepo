import type { Metadata } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined) ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
  "http://localhost:3004";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Tacoma Landscaping Concepts | TieGui",
  description:
    "Ten Tacoma-area landscaping website concepts rebuilt with stronger conversion paths, clearer offers, and a TieGui plus Twilio CRM stack.",
  openGraph: {
    title: "Tacoma Landscaping Concepts",
    description:
      "Homepage concepts for Tacoma-area landscapers showing clearer positioning, better lead capture, and CRM automation opportunities.",
    url: "/",
    siteName: "TieGui Concepts",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>{children}</body>
    </html>
  );
}
