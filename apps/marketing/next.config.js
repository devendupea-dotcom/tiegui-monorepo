import process from "node:process";
import { buildSecurityHeaders } from "../../packages/security-headers/index.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  async headers() {
    const isProduction = process.env.NODE_ENV === "production";
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders({
          allowUnsafeEval: !isProduction,
          enableHsts: isProduction,
          scriptSrc: [
            "https://www.googletagmanager.com",
            "https://connect.facebook.net",
          ],
          upgradeInsecureRequests: isProduction,
        }),
      },
    ];
  },
};

export default nextConfig;
