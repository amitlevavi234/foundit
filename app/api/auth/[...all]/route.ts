import { toNextJsHandler } from 'better-auth/next-js';

import { authConfigured, getAuth } from '@/lib/auth';

/**
 * Better Auth's own endpoints, mounted where the library expects them.
 *
 * The only one a visitor's browser actually lands on is the Google callback —
 * `/api/auth/callback/google`, which is the redirect URI registered in the
 * Google Cloud console and written out in docs/development.md. Everything else
 * this product does with sign-in goes through Server Actions instead
 * (app/sign-in/actions.ts), which is why the sign-in screen works with no
 * client-side JavaScript at all.
 *
 * A Route Handler gets none of the Origin/Host checking Next gives a Server
 * Action, which is exactly the gap Next's own security guide warns about and
 * why lib/auth.ts sets `trustedOrigins` to this deployment's real address
 * rather than leaving it open (research/09 §7).
 *
 * When sign-in is not configured this answers 503 rather than throwing: a
 * deployment with no secret and no database for sessions is a site that
 * searches and browses perfectly well, and a stack trace is not the answer to
 * a request for a feature that was never turned on.
 */
export const dynamic = 'force-dynamic';

function unavailable(): Response {
  return new Response('Sign-in is not configured on this deployment.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

async function handle(request: Request, method: 'GET' | 'POST'): Promise<Response> {
  if (!authConfigured()) return unavailable();
  const handlers = toNextJsHandler(getAuth().handler);
  return handlers[method](request);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, 'GET');
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, 'POST');
}
