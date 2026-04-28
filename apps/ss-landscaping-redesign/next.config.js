/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.squarespace-cdn.com" },
      { protocol: "https", hostname: "www.gpaklandscapingtacoma.com" },
      { protocol: "https", hostname: "static.wixstatic.com" },
      { protocol: "https", hostname: "cdn.prod.website-files.com" },
      { protocol: "https", hostname: "alvinslandscaping.com" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "impro.usercontent.one" },
      { protocol: "https", hostname: "www.oscarslawnserviceetc.com" },
      { protocol: "https", hostname: "nwlawnandlandscape.com" },
    ],
  },
};

export default nextConfig;
