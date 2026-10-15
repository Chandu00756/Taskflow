/** @type {import('next').NextConfig} */
const apiURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  poweredByHeader: false,
  // Separate build output lets CI/verification builds run next to `next dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Self-contained server bundle for the production container image.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  env: {
    NEXT_PUBLIC_API_URL: apiURL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080',
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiURL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
