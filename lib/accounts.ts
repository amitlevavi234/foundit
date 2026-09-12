import 'server-only';

import { cache } from 'react';
import { headers } from 'next/headers';
import type { PoolClient } from 'pg';

import {
  CREATE_PROFILE_SQL,
  CREATE_COLLECTION_SQL,
  LIBRARY_FOR_SLUGS_SQL,
  DELETE_ACCOUNT_SQL,
  DELETE_COLLECTION_SQL,
  DELETE_OWN_REVIEW_SQL,
  LIKE_SQL,
  PUBLIC_PROFILE_SQL,
  RENAME_COLLECTION_SQL,
  SAVED_SQL,
  SAVE_TOOL_SQL,
  SHARED_COLLECTION_SQL,
  SHARE_COLLECTION_SQL,
  TOOL_VIEWER_SQL,
  UNLIKE_SQL,
  UNSAVE_TOOL_SQL,
  UNSHARE_COLLECTION_SQL,
  UPDATE_PROFILE_SQL,
  UPSERT_REVIEW_SQL,
  VIEWER_SQL,
  collectionSlugCandidates,
  toLibrary,
  toPublicProfile,
  toSavedPage,
  toSharedCollection,
  toToolViewerState,
  type PublicProfile,
  type SavedPage,
  type SharedCollection,
  type ToolViewerState,
  type Viewer,
} from './account-sql';
import { authConfigured, getAuth } from './auth';
import { authPool } from './auth-db';
import { withIdentity } from './db';
import {
  DELETE_ACCOUNTS_SQL,
  DELETE_CODES_SQL,
  DELETE_SESSIONS_SQL,
  DELETE_USER_SQL,
  runDeletion,
  type DeletionOutcome,
} from './deletion';
import { handleCandidates } from './handle';

/* ===========================================================================
 * The identity half of every request, and the writes a signed-in person makes.
 *
 * Two rules hold this file together:
 *
 *   NOTHING HERE DECIDES WHO MAY DO WHAT. Every function below opens a
 *   transaction with the caller's identity attached and sends a statement. If
 *   the database says no, the statement affects no rows and the caller is told
 *   "no" — there is no `if (review.authorId === me)` anywhere in this codebase,
 *   because that check is not the application's job and an application that
 *   makes it will eventually make it wrong.
 *
 *   AN ERROR NEVER DISTINGUISHES "not yours" FROM "not there". Both are the
 *   same empty result and the same message. Telling them apart is an
 *   enumeration leak (research/09 §5.5).
 * ======================================================================== */

/**
 * The signed-in person's id, or null.
 *
 * `cache()` memoises for one render pass, so a page whose header, body and
 * three components each want to know does one session lookup rather than five.
 * A failure — no session, an expired one, a database that is not answering —
 * is null, which is a stranger, which is a page that renders.
 */
export const currentUserId = cache(async (): Promise<string | null> => {
  const session = await currentSession();
  return session?.user?.id ?? null;
});

interface SessionUser {
  id: string;
  email?: string | null;
  name?: string | null;
}

const currentSession = cache(async (): Promise<{ user: SessionUser } | null> => {
  if (!authConfigured()) return null;
  try {
    const session = await getAuth().api.getSession({ headers: await headers() });
    return (session as { user: SessionUser } | null) ?? null;
  } catch (error) {
    // The reason and nothing else. A session lookup that failed is a signed-out
    // page, which is a correct page.
    console.error(
      `the session could not be read (${
        (error as { code?: string } | null)?.code ?? 'unknown'
      }); this request is anonymous`,
    );
    return null;
  }
});

/** Run one statement with this request's identity attached. */
async function asViewer<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  return withIdentity({ userId: await currentUserId() }, fn);
}

/**
 * The signed-in person's profile, creating it if this is their first visit.
 *
 * The profile is made by the APPLICATION, in `public`, from what the session
 * says — never by Better Auth writing across the boundary into a schema it
 * holds no grant on. The row is created by the database hook on sign-up and
 * again here if that ever failed, because an account with no profile is an
 * account that cannot do anything and the repair is one insert.
 */
export const currentViewer = cache(async (): Promise<Viewer | null> => {
  const session = await currentSession();
  if (!session?.user?.id) return null;

  const existing = await readViewer(session.user.id);
  if (existing) return existing;

  await ensureProfile(session.user.id, session.user.email ?? null, session.user.name ?? null);
  return readViewer(session.user.id);
});

async function readViewer(userId: string): Promise<Viewer | null> {
  return withIdentity({ userId }, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      handle: string;
      display_name: string | null;
      bio: string | null;
      is_admin: boolean;
    }>(VIEWER_SQL, []);
    const row = rows[0];
    return row
      ? {
          id: row.id,
          handle: row.handle,
          displayName: row.display_name,
          bio: row.bio,
          isAdmin: row.is_admin,
        }
      : null;
  });
}

/**
 * Make the profile row for a new account.
 *
 * The handle comes from the local part of the address (lib/handle.ts) and is
 * deduplicated by walking candidates until the database accepts one — the
 * uniqueness is the unique index's to enforce, not this loop's, so two people
 * signing up at the same instant with the same stem cannot both win.
 *
 * A hundred failures means a hundred people share a stem, and the
 * hundred-and-first gets a random handle rather than this looping. They can
 * change it in Settings, which is where everybody can change it.
 */
export async function ensureProfile(
  userId: string,
  email: string | null,
  displayName: string | null,
): Promise<string | null> {
  const name = (displayName ?? '').trim().slice(0, 60) || null;

  for (const candidate of handleCandidates(email)) {
    const handle = await withIdentity({ userId }, async (tx) => {
      const { rows } = await tx.query<{ handle: string }>(CREATE_PROFILE_SQL, [candidate, name]);
      return rows[0]?.handle ?? null;
    });
    if (handle) return handle;

    // Nothing came back: either the profile already exists — somebody else's
    // request got there first, which is fine — or the handle is taken.
    const existing = await readViewer(userId);
    if (existing) return existing.handle;
  }

  const random = `friend${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')}`;
  return withIdentity({ userId }, async (tx) => {
    const { rows } = await tx.query<{ handle: string }>(CREATE_PROFILE_SQL, [random, name]);
    return rows[0]?.handle ?? null;
  });
}

/* ===========================================================================
 * Reads
 * ======================================================================== */

/** Everything /saved draws. One round trip. Empty for a stranger, by policy. */
export async function getSaved(collectionSlug: string | null = null): Promise<SavedPage> {
  return asViewer(async (tx) => {
    const { rows } = await tx.query<Parameters<typeof toSavedPage>[0]>(SAVED_SQL, [
      collectionSlug,
    ]);
    return toSavedPage(rows[0] ?? { collections: [], chosen: null, items: [] });
  });
}

/**
 * A shared collection, for somebody holding its link.
 *
 * The token goes in twice — as the transaction setting the policy reads and as
 * the statement's parameter — and the first is what makes the row visible at
 * all. A wrong token, a revoked one or an invented one is `null`, which the
 * page renders as "this link does not open anything", the same answer for all
 * three.
 */
export async function getSharedCollection(token: string): Promise<SharedCollection | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  return withIdentity({ userId: await currentUserId(), shareToken: token }, async (tx) => {
    const { rows } = await tx.query<Parameters<typeof toSharedCollection>[0]>(
      SHARED_COLLECTION_SQL,
      [token],
    );
    return rows[0] ? toSharedCollection(rows[0]) : null;
  });
}

/** A public profile, by handle. Reads profiles_public and never profiles. */
export async function getPublicProfile(
  handle: string,
  listingLimit = 24,
  reviewLimit = 20,
): Promise<PublicProfile | null> {
  return asViewer(async (tx) => {
    const { rows } = await tx.query<Parameters<typeof toPublicProfile>[0]>(PUBLIC_PROFILE_SQL, [
      handle,
      listingLimit,
      reviewLimit,
    ]);
    return rows[0] ? toPublicProfile(rows[0]) : null;
  });
}

/**
 * The same, for a page of results: one statement, twelve cards.
 *
 * Null for a stranger, which every control reads as "draw the gate". An empty
 * list of slugs asks nothing.
 */
export async function getLibraryFor(
  slugs: readonly string[],
): Promise<Map<string, ToolViewerState> | null> {
  const userId = await currentUserId();
  if (!userId || slugs.length === 0) return null;
  return withIdentity({ userId }, async (tx) => {
    const { rows } = await tx.query<Parameters<typeof toLibrary>[1]>(LIBRARY_FOR_SLUGS_SQL, [
      [...slugs],
    ]);
    return toLibrary(slugs, rows[0] ?? { collections: [], liked: [], holds: [] });
  });
}

/** Liked, saved and reviewed — this person, this tool. Null for a stranger. */
export async function getToolViewerState(slug: string): Promise<ToolViewerState | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  return withIdentity({ userId }, async (tx) => {
    const { rows } = await tx.query<Parameters<typeof toToolViewerState>[0]>(TOOL_VIEWER_SQL, [
      slug,
    ]);
    return rows[0] ? toToolViewerState(rows[0]) : null;
  });
}

/* ===========================================================================
 * Writes. Each returns whether the database did the thing, and nothing about
 * why it did not.
 * ======================================================================== */

export async function setLiked(slug: string, liked: boolean): Promise<void> {
  await asViewer(async (tx) => {
    await tx.query(liked ? LIKE_SQL : UNLIKE_SQL, [slug]);
  });
}

/**
 * Make a collection, finding a free address for it.
 *
 * The uniqueness is `unique (owner_id, slug)`'s to enforce; this walks
 * candidates until the database accepts one rather than asking first, so two
 * tabs creating "Trip planning" at the same instant cannot both win.
 */
export async function createCollection(name: string, description = ''): Promise<string | null> {
  const trimmed = name.trim().slice(0, 60);
  if (trimmed === '') return null;

  for (const candidate of collectionSlugCandidates(trimmed)) {
    const slug = await asViewer(async (tx) => {
      const { rows } = await tx.query<{ slug: string }>(CREATE_COLLECTION_SQL, [
        trimmed,
        candidate,
        description,
      ]);
      return rows[0]?.slug ?? null;
    });
    if (slug) return slug;
  }
  return null;
}

export async function renameCollection(
  id: string,
  name: string,
  description = '',
): Promise<boolean> {
  return asViewer(async (tx) => {
    const { rowCount } = await tx.query(RENAME_COLLECTION_SQL, [id, name, description]);
    return (rowCount ?? 0) > 0;
  });
}

export async function deleteCollection(id: string): Promise<boolean> {
  return asViewer(async (tx) => {
    const { rowCount } = await tx.query(DELETE_COLLECTION_SQL, [id]);
    return (rowCount ?? 0) > 0;
  });
}

/**
 * Turn sharing on, and hand back the link's token.
 *
 * The token is minted here with the platform's cryptographic random source —
 * 16 bytes, 128 bits — because the link IS the permission. `Math.random` would
 * be a guessable address for somebody's list, which is the whole failure.
 */
export async function shareCollection(id: string): Promise<string | null> {
  const { randomBytes } = await import('node:crypto');
  const token = randomBytes(16).toString('hex');
  return asViewer(async (tx) => {
    const { rows } = await tx.query<{ share_token: string }>(SHARE_COLLECTION_SQL, [id, token]);
    return rows[0]?.share_token ?? null;
  });
}

export async function unshareCollection(id: string): Promise<boolean> {
  return asViewer(async (tx) => {
    const { rowCount } = await tx.query(UNSHARE_COLLECTION_SQL, [id]);
    return (rowCount ?? 0) > 0;
  });
}

export async function saveTool(
  collectionId: string,
  slug: string,
  note = '',
): Promise<boolean> {
  return asViewer(async (tx) => {
    const { rowCount } = await tx.query(SAVE_TOOL_SQL, [collectionId, slug, note]);
    return (rowCount ?? 0) > 0;
  });
}

export async function unsaveTool(collectionId: string, slug: string): Promise<boolean> {
  return asViewer(async (tx) => {
    const { rowCount } = await tx.query(UNSAVE_TOOL_SQL, [collectionId, slug]);
    return (rowCount ?? 0) > 0;
  });
}

/** The cap on a written review, matching `reviews.body`'s own CHECK. */
export const MAX_REVIEW_BODY = 2000;

export async function writeReview(
  slug: string,
  rating: number,
  body: string,
): Promise<boolean> {
  // The database checks this too — `rating between 1 and 5` — and a value it
  // would refuse should not become a round trip and an exception page.
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return false;
  const text = body.slice(0, MAX_REVIEW_BODY);
  return asViewer(async (tx) => {
    const { rowCount } = await tx.query(UPSERT_REVIEW_SQL, [slug, rating, text]);
    return (rowCount ?? 0) > 0;
  });
}

export async function deleteOwnReview(slug: string): Promise<boolean> {
  return asViewer(async (tx) => {
    const { rowCount } = await tx.query(DELETE_OWN_REVIEW_SQL, [slug]);
    return (rowCount ?? 0) > 0;
  });
}

export async function updateProfile(
  displayName: string,
  bio: string,
  handle: string | null,
): Promise<string | null> {
  return asViewer(async (tx) => {
    const { rows } = await tx.query<{ handle: string }>(UPDATE_PROFILE_SQL, [
      displayName.slice(0, 60),
      bio.slice(0, 280),
      handle,
    ]);
    return rows[0]?.handle ?? null;
  });
}

/* ===========================================================================
 * Deleting an account
 *
 * The ordering, the reason for it and the one place it can half-happen are all
 * in lib/deletion.ts, which is the function this calls and the function
 * tests/deletion.test.mjs drives. What is here is only the binding: which pool
 * each step runs on, and under whose identity.
 * ======================================================================== */

/**
 * Close an account. Returns what each step removed — for the confirmation the
 * screen shows, and for the before-and-after this phase has to prove.
 */
export async function deleteAccount(): Promise<DeletionOutcome | null> {
  const session = await currentSession();
  const userId = session?.user?.id;
  if (!userId) return null;
  const email = (session?.user?.email ?? '').toLowerCase();

  const auth = authPool();
  const rows = async (sql: string, values: unknown[]) =>
    (await auth.query(sql, values)).rowCount ?? 0;

  return runDeletion({
    sessions: () => rows(DELETE_SESSIONS_SQL, [userId]),
    // Under their own identity, so the delete policy — `id = auth.uid()` — is
    // what permits it rather than a predicate written here.
    publicRows: () =>
      withIdentity({ userId }, async (tx) => {
        const { rowCount } = await tx.query(DELETE_ACCOUNT_SQL, []);
        return rowCount ?? 0;
      }),
    accounts: () => rows(DELETE_ACCOUNTS_SQL, [userId]),
    codes: () => (email ? rows(DELETE_CODES_SQL, [email]) : Promise.resolve(0)),
    user: () => rows(DELETE_USER_SQL, [userId]),
  });
}
