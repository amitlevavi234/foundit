'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { authConfigured, emailCodeConfigured, getAuth, googleConfigured } from '@/lib/auth';
import { allowSignInCode } from '@/lib/rate-limit';
import {
  PENDING_ADDRESS,
  PENDING_NEXT,
  PENDING_SECONDS,
  codeFromForm,
  looksLikeEmail,
  safeNext,
} from '@/lib/sign-in';
import { visitorAddress } from '@/lib/visitor';

/* ===========================================================================
 * Signing in, as four Server Actions and no client-side JavaScript.
 *
 * Better Auth mounts a Route Handler (app/api/auth/[...all]/route.ts) and its
 * client library talks to it with fetch. This product does it the other way
 * round: the screen is a form, the form posts to an action, the action asks
 * the library, and the `nextCookies()` plugin writes the session cookie out of
 * the action's response. So sign-in works with scripting switched off — which
 * is worth more on this screen than on any other, because it is the one people
 * reach on a locked-down work laptop or a browser they do not control.
 *
 * WHAT THESE NEVER DO IS SAY WHETHER AN ADDRESS HAS AN ACCOUNT. Asking for a
 * code always advances to the code screen, and always takes the same time,
 * because the send is not awaited (lib/email.ts). Checking a code fails the
 * same way for a wrong code, an expired one, a third wrong guess and an
 * address nobody has ever used. research/09 §6: the naive version of this flow
 * publishes the user list to anybody holding a list of addresses.
 * ======================================================================== */

function pendingCookie(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PENDING_SECONDS,
  };
}

function back(to: string, params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  redirect(query ? `${to}?${query}` : to);
}

/** Start the Google flow. Ends at Google, or back here with a reason. */
export async function startGoogle(formData: FormData): Promise<void> {
  const next = safeNext(String(formData.get('next') ?? ''));
  if (!authConfigured() || !googleConfigured()) back('/sign-in', { next, problem: 'no-google' });

  let url: string | null = null;
  try {
    const result = await getAuth().api.signInSocial({
      body: { provider: 'google', callbackURL: next, errorCallbackURL: '/sign-in?problem=google' },
    });
    url = (result as { url?: string } | null)?.url ?? null;
  } catch (error) {
    // The reason, never the response: an OAuth error body can carry the client
    // id and the state parameter.
    console.error(`Google sign-in could not be started (${(error as Error)?.name ?? 'unknown'})`);
  }

  if (!url) back('/sign-in', { next, problem: 'google' });
  redirect(url);
}

/**
 * Ask for a 6-digit code.
 *
 * Two limits before anything is sent (lib/rate-limit.ts): five an hour for one
 * address, because otherwise anybody who knows somebody's address can have us
 * mail them a code a second from a domain whose reputation is ours; and twenty
 * an hour for one connection, because a script working through a list of
 * addresses is one connection here.
 */
export async function requestCode(formData: FormData): Promise<void> {
  const next = safeNext(String(formData.get('next') ?? ''));
  const email = String(formData.get('email') ?? '').trim();

  if (!authConfigured() || !emailCodeConfigured()) back('/sign-in', { next, problem: 'no-email' });
  if (!looksLikeEmail(email)) back('/sign-in', { next, problem: 'address' });

  const allowance = allowSignInCode(email, await visitorAddress());
  if (!allowance.allowed) {
    back('/sign-in', {
      next,
      problem: 'too-many',
      wait: String(allowance.retryAfterSeconds),
      scope: allowance.refusedBy ?? 'address',
    });
  }

  try {
    await getAuth().api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
  } catch (error) {
    // Deliberately swallowed. Whether an address can be signed in with is
    // exactly what this flow must not reveal, so the screen advances either
    // way and the reason goes to the log.
    console.error(`a sign-in code was not issued (${(error as Error)?.name ?? 'unknown'})`);
  }

  // The address goes in an httpOnly cookie rather than in the URL: the next
  // screen has to say which address it went to, and a query string ends up in
  // history, in a bookmark, and in whatever reads the address bar.
  const jar = await cookies();
  jar.set(PENDING_ADDRESS, email, pendingCookie());
  jar.set(PENDING_NEXT, next, pendingCookie());

  redirect('/sign-in/code');
}

/** Check a code. On success `nextCookies()` writes the session cookie. */
export async function verifyCode(formData: FormData): Promise<void> {
  const jar = await cookies();
  const email = jar.get(PENDING_ADDRESS)?.value ?? '';
  const next = safeNext(jar.get(PENDING_NEXT)?.value ?? '/');
  const code = codeFromForm(formData);

  if (!authConfigured() || !email) redirect('/sign-in');
  if (code.length !== 6) back('/sign-in/code', { problem: 'short' });

  let signedIn = false;
  try {
    const result = await getAuth().api.signInEmailOTP({
      body: { email, otp: code },
      headers: await headers(),
    });
    signedIn = Boolean((result as { user?: { id?: string } } | null)?.user?.id);
  } catch {
    signedIn = false;
  }

  if (!signedIn) back('/sign-in/code', { problem: 'code' });

  jar.delete(PENDING_ADDRESS);
  jar.delete(PENDING_NEXT);
  redirect(next);
}

/** Start again with a different address. */
export async function useAnotherAddress(): Promise<void> {
  const jar = await cookies();
  jar.delete(PENDING_ADDRESS);
  jar.delete(PENDING_NEXT);
  redirect('/sign-in');
}

/**
 * Sign out: the server-side row goes, not just the cookie.
 *
 * OWASP is explicit that a session has to be invalidated on both sides, and a
 * cookie the browser dropped is not an invalidated session — it is a session
 * whose token is still in whatever logged it.
 */
export async function signOut(): Promise<void> {
  if (authConfigured()) {
    try {
      await getAuth().api.signOut({ headers: await headers() });
    } catch (error) {
      console.error(`signing out failed (${(error as Error)?.name ?? 'unknown'})`);
    }
  }
  redirect('/');
}
