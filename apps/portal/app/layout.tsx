import type { Metadata } from "next";
import { Barlow_Condensed, DM_Sans } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import Providers from "./providers";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-body",
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: {
    default: "TieGui Portal",
    template: "%s | TieGui Portal",
  },
  description: "TieGui operations portal for jobs, estimates, messaging, invoicing, and field workflows.",
};

const THEME_INIT_SCRIPT = `
(() => {
  try {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
  } catch (_error) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${dmSans.variable} ${barlowCondensed.variable} ${geistMono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
