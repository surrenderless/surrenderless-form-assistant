import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@': path.resolve('./src'),
      'crewai/src/crewai/cli/cli': false,
    };

    config.module.rules.push({
      test: /\.css$/,
      use: ['style-loader', 'css-loader', 'postcss-loader'],
    });

    return config;
  },
};

export default nextConfig;
