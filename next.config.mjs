import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  turbopack: {},

  // keep build leniency
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  // TEMPORARY: only true for the E2E diagnostic build (set by scripts/e2e-pretest-build.mjs),
  // never for a normal production build. Lets a CDP-attached Playwright test map minified
  // breakpoint offsets in the chat-ai chunk back to original source. Remove alongside the
  // other temporary E2E diagnostics once the packet-approval auto-approve investigation
  // concludes.
  productionBrowserSourceMaps: process.env.E2E_DIAGNOSTIC_SOURCE_MAPS_ENABLED === "1",

  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": path.resolve("./src"),
      "crewai/src/crewai/cli/cli": false,
    };
    return config;
  },
};

export default nextConfig;