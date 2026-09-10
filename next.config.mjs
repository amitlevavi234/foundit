/**
 * Foundit runs as an ordinary Node server on a 4 GB Hetzner box behind
 * Cloudflare. Nothing here may assume a serverless platform, an image CDN, or
 * anything that reaches out to a third party at request time.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,

  // This repository is the whole application. Say so, or Next walks up the
  // tree looking for a workspace root and traces the wrong directory into the
  // standalone output.
  outputFileTracingRoot: import.meta.dirname,

  // `standalone` produces a self-contained server directory for the box.
  output: 'standalone',

  // `pg` is a native-ish driver with dynamic requires. Keep it out of the
  // server bundle and let Node resolve it from node_modules at runtime.
  serverExternalPackages: ['pg'],

  // No remote image loader. The server never fetches a URL a stranger
  // supplied, and a remote loader pointed at a submitted tool URL would be
  // exactly that. Tool URLs are rendered as links and nothing else.
  images: {
    remotePatterns: [],
    dangerouslyAllowSVG: false,
  },

  // Version and stack are free reconnaissance.
  poweredByHeader: false,
};

export default nextConfig;
