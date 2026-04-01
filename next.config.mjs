import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  turbopack: {},

  // keep build leniency
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  webpack(config) {
    // keep your aliases
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": path.resolve("./src"),
      "crewai/src/crewai/cli/cli": false,
    };

    // keep your css rule
    config.module.rules.push({
      test: /\.css$/,
      use: ["style-loader", "css-loader", "postcss-loader"],
    });

    return config;
  },
};

export default nextConfig;