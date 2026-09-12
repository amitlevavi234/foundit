/**
 * Google's four-colour G, verbatim from `gLogo` in design/canvas/build.mjs.
 *
 * Drawn rather than loaded, like every other icon here: a logo fetched from
 * Google's CDN would be our page asking a third party for a file on every
 * render, which is a request nobody made and one more thing to fail.
 *
 * It is the only mark in this codebase that is not ours, and it keeps its own
 * colours because a monochrome Google button is not a Google button —
 * recognising it at a glance is the whole of what it is for.
 */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ flex: 'none' }}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"
      />
      <path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9z" />
      <path
        fill="#EA4335"
        d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.8 9.4 6 12 6z"
      />
    </svg>
  );
}
