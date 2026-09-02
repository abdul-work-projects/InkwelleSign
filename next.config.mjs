/** @type {import('next').NextConfig} */
const nextConfig = {
  // Kept out of the bundler: better-sqlite3 loads a native binding by expression, and
  // nodemailer reaches for node:stream, which the edge compilation of instrumentation.js
  // cannot resolve.
  serverExternalPackages: ['better-sqlite3', 'nodemailer'],
  poweredByHeader: false,
  // `next/image` optimisation is unused, and disabling it keeps the optional `sharp`
  // dependency (LGPL-3.0 libvips) out of the tree. See scripts/prune-optional.mjs.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};
export default nextConfig;
