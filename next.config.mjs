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

  /* -------------------------------------------------------------------------
   * The security headers on the paths `middleware.ts` deliberately skips.
   *
   * THE PHASE 9a REVIEW'S F24. `middleware.ts`'s matcher excludes
   * `_next/static`, `_next/image`, `favicon.ico`, `icon.svg` and
   * `apple-icon.png`, and the reason is sound: those responses have no HTML
   * and no script to nonce, and minting a nonce per chunk would make every
   * asset response vary, which is precisely what Cloudflare cache rule 2
   * (server/cloudflare/README.md) is arranged to avoid.
   *
   * The consequence was not intended. Every chunk came back with a
   * `Cache-Control` and nothing else — no `nosniff`, no `Referrer-Policy`, no
   * HSTS, no COOP, no CORP — and `server/cloudflare/README.md` explicitly
   * forbids adding a Transform Rule to put them back at the edge, so there was
   * nowhere else for them to come from. `nosniff` is the one that matters most
   * on a path serving JavaScript.
   *
   * THESE ARE THE SAME HEADERS `middleware.ts` SETS, MINUS THE TWO THAT VARY
   * PER REQUEST: no `Content-Security-Policy` (it carries the nonce) and no
   * `x-nonce`. `headers()` in this file is static, which is exactly why the
   * policy could not live here in the first place — and exactly why these can.
   * tests/headers.test.mjs reads both lists and fails if they drift apart, and
   * asks a real chunk for them off a running server.
   * ---------------------------------------------------------------------- */
  async headers() {
    return [
      {
        source: '/:path(_next/static/.*|_next/image|favicon.ico|icon.svg|apple-icon.png)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
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
