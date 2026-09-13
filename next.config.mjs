import { withSentryConfig } from '@sentry/nextjs/config';

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

/* ===========================================================================
 * Sentry (Phase 9a, research/10 §7.2)
 *
 * `withSentryConfig` is what wires the three `Sentry.init` calls into the
 * build: it registers `instrumentation-client.ts` for the browser and leaves
 * `instrumentation.ts` to load the server and edge configs by runtime.
 *
 * FOUR OPTIONS, AND EACH ONE IS A DECISION:
 *
 *   `silent`              no build chatter unless something is wrong.
 *
 *   `sourcemaps.disable`  NO SOURCE MAPS ARE GENERATED OR UPLOADED. Uploading
 *                         them needs a `SENTRY_AUTH_TOKEN` at build time, and
 *                         the build happens in CI: that is a credential on a
 *                         public runner in exchange for un-minified frame
 *                         names. The Dockerfile carries the same note.
 *
 *   `webpack.treeshake`   drops Sentry's own debug logging from the bundle.
 *                         (The old `disableLogger` spelling is deprecated.)
 *
 *   `telemetry: false`    the plugin reports build metadata to Sentry by
 *                         default. Nothing about this repository's build is
 *                         theirs, and with no DSN configured here it would be
 *                         the only request the build makes.
 *
 * THERE IS NO `tunnelRoute`. research/10 §7.2 suggests one so that ad
 * blockers do not drop events; it works by having the BROWSER post events to a
 * path on this origin, which the SERVER then forwards to Sentry — that is the
 * server making an outbound request to an address derived from something a
 * visitor sent, which is the one thing tests/markup.test.mjs exists to stop.
 * The trade is that some events are blocked in some browsers. That is the
 * right way round.
 * ======================================================================== */
export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  webpack: { treeshake: { removeDebugLogging: true } },
  sourcemaps: { disable: true },
});
