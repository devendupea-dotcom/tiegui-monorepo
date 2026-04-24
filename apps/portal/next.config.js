import process from "node:process";
import withSerwistInit from "@serwist/next";
import createNextIntlPlugin from "next-intl/plugin";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
});
const withNextIntlBase = createNextIntlPlugin("./i18n.ts");

function withNextIntl(nextConfig) {
  const config = withNextIntlBase(nextConfig);

  if (config && typeof config === "object" && "turbopack" in config) {
    delete config.turbopack;
  }

  return config;
}

function isKnownServerInstrumentationWarning(warning) {
  const message = String(warning?.message ?? "");
  const moduleResource = String(
    warning?.module?.resource ?? warning?.module?.userRequest ?? "",
  );
  const dynamicDependencyWarning =
    message.includes(
      "Critical dependency: require function is used in a way in which dependencies cannot be statically extracted",
    ) ||
    message.includes(
      "Critical dependency: the request of a dependency is an expression",
    );

  return (
    dynamicDependencyWarning &&
    (moduleResource.includes("require-in-the-middle") ||
      moduleResource.includes("@opentelemetry/instrumentation") ||
      moduleResource.includes("@prisma/instrumentation"))
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config, { isServer }) {
    if (isServer) {
      config.ignoreWarnings = [
        ...(config.ignoreWarnings ?? []),
        isKnownServerInstrumentationWarning,
      ];
    }

    return config;
  },
};

export default withSerwist(withNextIntl(nextConfig));
