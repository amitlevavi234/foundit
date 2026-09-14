/* ===========================================================================
 * Installing `markRouterRequest` on every HTTP server in this process.
 *
 * The reasoning, the quotations from Next's own source and the two defects
 * this closes (OWNER FEEDBACK, ROUND 1, F3 and F24) are all in
 * `lib/router-headers.ts`. This file is only the part that touches
 * `node:http`, and it is a separate file for one reason: `middleware.ts`
 * imports the constants from that one, middleware is bundled for the EDGE
 * runtime, and an `import('node:http')` anywhere in that module graph fails
 * the build.
 * ======================================================================== */

import { markRouterRequest, type HeaderBag } from './router-headers.ts';

let installed = false;

/** Patch every HTTP server in this process, once. Node runtime only. */
export async function installRouterHeaderShim(): Promise<void> {
  if (installed) return;
  installed = true;

  const http = await import('node:http');
  const server = http.Server.prototype as unknown as {
    emit: (event: string, ...args: unknown[]) => boolean;
  };
  const original = server.emit;

  server.emit = function patched(event: string, ...args: unknown[]): boolean {
    if (event === 'request') {
      const request = args[0] as HeaderBag | undefined;
      // Defensive: an `emit('request')` with something other than a request on
      // it is not ours to fix, and a throw here would be a dead server.
      if (request && typeof request === 'object' && request.headers) {
        try {
          markRouterRequest(request);
        } catch {
          /* a header this shim could not rewrite is a page view miscounted,
             which is not a reason for anybody to see an error page */
        }
      }
    }
    return original.call(this, event, ...args);
  };
}
