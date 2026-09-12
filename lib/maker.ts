import 'server-only';

import { cache } from 'react';

import { currentUserId } from './accounts';
import { withIdentity } from './db';
import {
  CLAIMABLE_SQL,
  CLAIM_SQL,
  CREATE_DRAFT_SQL,
  EXISTING_BY_URL_SQL,
  PUBLISH_SQL,
  SET_STATEMENTS_SQL,
  SQLSTATE_DUPLICATE,
  UPDATE_LISTING_SQL,
  runMakerDashboard,
  runMyDraft,
  runMyListings,
  type DraftListing,
  type MakerDashboard,
  type MakerListing,
} from './tool-sql';
import type { Submission } from './submit';
import { slugCandidates } from './submit';

/* ===========================================================================
 * What a maker does, with their identity attached to every statement.
 *
 * The rules this file inherits from lib/accounts.ts are the whole design:
 *
 *   NOTHING HERE DECIDES WHO MAY DO WHAT. Every function opens a transaction
 *   carrying the caller's identity and sends a statement. If the database says
 *   no the statement affects no rows, or the definer function raises, and the
 *   caller is told "no". There is no ownership check in this file.
 *
 *   AN ERROR NEVER DISTINGUISHES "not yours" FROM "not there".
 *
 * What is NEW here, and is this phase's one addition to that list:
 *
 *   ROW-LEVEL SECURITY FILTERS, IT DOES NOT REFUSE. An UPDATE on somebody
 *   else's listing succeeds and touches nothing. That is the shape of the
 *   defect Phase 6 found in the counters — four rows, a count of three, no
 *   error — so every write here reads the row count back and answers `false`
 *   when it is zero, rather than answering "done" because nothing threw.
 * ======================================================================== */

/** Run one statement with this request's identity attached. */
async function asViewer<T>(fn: Parameters<typeof withIdentity>[1]): Promise<T> {
  return withIdentity({ userId: await currentUserId() }, fn) as Promise<T>;
}

/* ===========================================================================
 * Reading
 * ======================================================================== */

/** Every listing this person maintains. Empty for a stranger. */
export const myListings = cache(async (): Promise<MakerListing[]> => {
  const me = await currentUserId();
  if (!me) return [];
  return asViewer(async (tx) => runMyListings(tx, me));
});

/**
 * One listing's maker dashboard, or null.
 *
 * Null for a slug that does not exist, for a listing somebody else maintains,
 * and for a stranger — one answer, on purpose.
 */
export const makerDashboard = cache(async (slug: string): Promise<MakerDashboard | null> => {
  const me = await currentUserId();
  if (!me) return null;
  return asViewer(async (tx) => runMakerDashboard(tx, slug, me));
});

/** The listing a step of the submit flow is editing, or null. */
export async function myDraft(toolId: string): Promise<DraftListing | null> {
  if (!/^[0-9]{1,19}$/.test(toolId)) return null;
  if (!(await currentUserId())) return null;
  return asViewer(async (tx) => runMyDraft(tx, toolId));
}

export interface ClaimableListing {
  id: string;
  slug: string;
  name: string;
  url: string;
  summary: string;
  claimable: boolean;
  owned: boolean;
  ownerHandle: string | null;
  ratingCount: number;
  reviewCount: number;
}

/** The listing a claim screen is about. Published listings only. */
export async function claimableListing(slug: string): Promise<ClaimableListing | null> {
  return asViewer(async (tx) => {
    const { rows } = await tx.query(CLAIMABLE_SQL, [slug]);
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      url: String(row.url),
      summary: String(row.summary),
      claimable: row.claimable === true,
      owned: row.owned === true,
      ownerHandle: typeof row.owner_handle === 'string' ? row.owner_handle : null,
      ratingCount: Number(row.rating_count ?? 0),
      reviewCount: Number(row.review_count ?? 0),
    };
  });
}

/* ===========================================================================
 * Writing
 * ======================================================================== */

/** Why a write did not happen, in a shape a page can turn into a sentence. */
export type WriteOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'refused' | 'duplicate' | 'invalid'; message: string; detail?: string };

/** A refusal, narrowed so the caller can read `reason` without a guard. */
type Refusal = Extract<WriteOutcome<never>, { ok: false }>;

/** The SQLSTATEs 0017's functions raise, and what each means to a person. */
function refusalOf(error: unknown): Refusal {
  const code = (error as { code?: string } | null)?.code ?? '';
  const message = (error as { message?: string } | null)?.message ?? '';

  if (code === SQLSTATE_DUPLICATE) {
    return {
      ok: false,
      reason: 'duplicate',
      message: 'That address is already listed.',
    };
  }
  // 42501 insufficient_privilege — "that listing is not yours". 22023, 22001
  // and 23514 are the value refusals: a statement too long, a set too large, a
  // listing already published. Every one of them is a sentence the function
  // itself wrote, and those are safe to show: they name a field or a rule and
  // never echo the submitted text.
  if (code === '42501') {
    return { ok: false, reason: 'refused', message: 'That listing is not yours to change.' };
  }
  if (code === '22023' || code === '22001' || code === '23514' || code === '23503') {
    return { ok: false, reason: 'invalid', message: message || 'The database refused that.' };
  }

  // Anything else is ours, not the person's. The reason is logged and the
  // submitted text is not — a maker's unpublished problem statement is not log
  // material.
  console.error(`a maker's write failed (${code || 'unknown'})`);
  return {
    ok: false,
    reason: 'refused',
    message: 'Something went wrong saving that. Nothing was changed.',
  };
}

/**
 * Create the draft, with a slug the database picked from a list of candidates.
 *
 * `status = 'draft'` and `submitted_by = <me>` are the only two things about
 * this insert the policy will accept (0017's `tools_insert`), and the four
 * columns a person does not get to decide are stamped by the trigger. So this
 * function passes what a form can legitimately carry and nothing else.
 *
 * A duplicate `url` comes back as `{ reason: 'duplicate' }` carrying the
 * existing listing's PUBLIC NAME and nothing else about it.
 */
export async function createDraft(
  submission: Submission,
): Promise<WriteOutcome<{ id: string; slug: string }>> {
  const me = await currentUserId();
  if (!me) return { ok: false, reason: 'refused', message: 'Sign in to add a tool.' };

  return asViewer(async (tx) => {
    try {
      const { rows } = await tx.query(CREATE_DRAFT_SQL, [
        slugCandidates(submission.name),
        submission.name,
        submission.url,
        submission.summary,
        submission.pricing,
        submission.platforms,
        submission.languages,
        submission.flags,
        me,
      ]);
      const row = rows[0] as { id: string | number; slug: string } | undefined;
      if (!row) {
        // No row and no error means the policy filtered the insert, or every
        // candidate slug was taken. Both are "we could not", and neither is
        // worth telling apart to the person.
        return {
          ok: false,
          reason: 'refused',
          message: 'We could not create the listing. Try a slightly different name.',
        };
      }
      return { ok: true, value: { id: String(row.id), slug: row.slug } };
    } catch (error) {
      const outcome = refusalOf(error);
      if (outcome.reason !== 'duplicate') return outcome;

      // The message names the existing listing, by its public name only. A
      // collision with an unpublished row comes back with no name at all.
      const { rows } = await tx.query(EXISTING_BY_URL_SQL, [submission.url]);
      const existing = rows[0] as { name: string; slug: string } | undefined;
      return existing
        ? {
            ok: false,
            reason: 'duplicate',
            message: `We already list ${existing.name}.`,
            detail: existing.slug,
          }
        : {
            ok: false,
            reason: 'duplicate',
            message: 'That address is already listed.',
          };
    }
  });
}

/** Edit the eight fields 0017 grants UPDATE on. */
export async function updateListing(
  toolId: string,
  submission: Submission,
): Promise<WriteOutcome<true>> {
  return asViewer(async (tx) => {
    try {
      const { rows } = await tx.query(UPDATE_LISTING_SQL, [
        toolId,
        submission.name,
        submission.summary,
        submission.pricing,
        submission.platforms,
        submission.languages,
        submission.flags,
      ]);
      // Zero rows is the policy filtering, not an error. See the header.
      if (rows.length === 0) {
        return { ok: false, reason: 'refused', message: 'That listing is not yours to change.' };
      }
      return { ok: true, value: true };
    } catch (error) {
      return refusalOf(error);
    }
  });
}

export interface StatementChange {
  added: number;
  removed: number;
  kept: number;
}

/** Replace the listing's problem statements. One door, 0017 §3. */
export async function setStatements(
  toolId: string,
  statements: readonly string[],
): Promise<WriteOutcome<StatementChange>> {
  return asViewer(async (tx) => {
    try {
      const { rows } = await tx.query(SET_STATEMENTS_SQL, [toolId, statements]);
      const row = rows[0] as Record<string, unknown> | undefined;
      return {
        ok: true,
        value: {
          added: Number(row?.added ?? 0),
          removed: Number(row?.removed ?? 0),
          kept: Number(row?.kept ?? 0),
        },
      };
    } catch (error) {
      return refusalOf(error);
    }
  });
}

/** Draft to published, now. The triggers queue the vectors. */
export async function publishListing(toolId: string): Promise<WriteOutcome<string>> {
  return asViewer(async (tx) => {
    try {
      const { rows } = await tx.query(PUBLISH_SQL, [toolId]);
      const slug = (rows[0] as { slug?: string } | undefined)?.slug;
      if (!slug) {
        return { ok: false, reason: 'refused', message: 'That listing is not yours to publish.' };
      }
      return { ok: true, value: slug };
    } catch (error) {
      return refusalOf(error);
    }
  });
}

/** One click. The evidence link is stored as text and never fetched. */
export async function claimListing(
  toolId: string,
  evidenceUrl: string | null,
): Promise<WriteOutcome<string>> {
  return asViewer(async (tx) => {
    try {
      const { rows } = await tx.query(CLAIM_SQL, [toolId, evidenceUrl]);
      const slug = (rows[0] as { slug?: string } | undefined)?.slug;
      if (!slug) {
        return { ok: false, reason: 'refused', message: 'That listing cannot be claimed.' };
      }
      return { ok: true, value: slug };
    } catch (error) {
      return refusalOf(error);
    }
  });
}
