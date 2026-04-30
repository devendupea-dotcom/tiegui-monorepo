import type { Metadata } from "next";
import { Barlow_Condensed, DM_Sans } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import Providers from "./providers";
import PreserveSamePathScroll from "./_components/preserve-same-path-scroll";

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
  description:
    "TieGui operations workspace for leads, operational jobs, estimates, messaging, invoicing, and field workflows.",
};

const THEME_INIT_SCRIPT = `
(() => {
  try {
    const storageKey = "tiegui-theme";
    const stored = window.localStorage.getItem(storageKey);
    const preference =
      stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    const resolved =
      preference === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : preference;
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
    root.classList.toggle("dark", resolved === "dark");
  } catch (_error) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className={`${dmSans.variable} ${barlowCondensed.variable} ${geistMono.variable}`}
      >
        <Providers>
          <PreserveSamePathScroll />
          {children}
        </Providers>
      </body>
    </html>
  );
}
