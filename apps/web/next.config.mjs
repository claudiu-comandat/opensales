/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    typedRoutes: true,
  },
  // Proxy /rpc/* to the API is handled by app/rpc/[...path]/route.ts
  // (Route Handler reads API_URL per request — true runtime lookup).
  // We can't use next.config.mjs.rewrites() here because that function
  // runs at BUILD time, baking process.env.API_URL into the build output.
  // Resolve `import './foo.js'` -> `./foo.ts` so Node-ESM-style relative
  // imports compile under Next.js webpack. Vitest already handles this via
  // SWC; production build needs this alias.
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
