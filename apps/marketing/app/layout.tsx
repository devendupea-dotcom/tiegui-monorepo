import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import { siteCopy } from "../content/siteCopy";
import AnalyticsScripts from "./_components/AnalyticsScripts";
import "./globals.css";

const serif = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://tieguisolutions.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteCopy.seo.defaultTitle,
    template: siteCopy.seo.titleTemplate,
  },
  description: siteCopy.seo.description,
  openGraph: {
    title: siteCopy.seo.defaultTitle,
    description: siteCopy.seo.openGraphDescription,
    url: "/",
    siteName: siteCopy.seo.siteName,
    type: "website",
    images: [
      {
        url: "/logo/tiegui-logo-dark.png",
        width: 1200,
        height: 630,
        alt: siteCopy.brand.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteCopy.seo.defaultTitle,
    description: siteCopy.seo.openGraphDescription,
    images: ["/logo/tiegui-logo-dark.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${serif.variable} ${sans.variable}`}>
        <AnalyticsScripts />
        {children}
      </body>
    </html>
  );
}
