import 'server-only';

import { cache } from 'react';

import { currentUserId } from './accounts';
import { withIdentity } from './db';
import {
  CATEGORIES_SQL,
  CLAIMABLE_SQL,
  CLAIM_SQL,
  SET_CATEGORY_SQL,
  PUBLISH_SQL,
  SET_STATEMENTS_SQL,
  SQLSTATE_DUPLICATE,
  UPDATE_LISTING_SQL,
  runCreateDraft,
  runMakerDashboard,
  runMyDraft,
  runMyListing,
  runMyListings,
  type DraftListing,
  type MakerDashboard,
  type MakerListing,
  type MyListing,
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

export interface CategoryOption {
  slug: string;
  name: string;
}

/**
 * The editorial categories, for the Details step's select.
 *
 * Cached for the render pass like everything else here. Read with no identity
 * required: `categories_read` is `using (true)` (0001) and the list is on
 * /browse already.
 */
export const categoryOptions = cache(async (): Promise<CategoryOption[]> => {
  return asViewer(async (tx) => {
    const { rows } = await tx.query(CATEGORIES_SQL, []);
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      slug: String(row.slug),
      name: String(row.name),
    }));
  });
});

/**
 * The DRAFT a step of the submit flow is editing, or null.
 *
 * Null for a listing that is already published, which is F7: the Preview step
 * kept drawing an enabled "Publish it" button for a live listing, and every
 * replay of that form spent one of three daily publishes on a no-op. Use
 * `myListing` to tell "already published" from "not yours" and "not there".
 */
export async function myDraft(toolId: string): Promise<DraftListing | null> {
  if (!/^[0-9]{1,19}$/.test(toolId)) return null;
  if (!(await currentUserId())) return null;
  return asViewer(async (tx) => runMyDraft(tx, toolId, true));
}

/** The same listing whatever its status — what the EDIT screen reads. */
export async function myListingToEdit(toolId: string): Promise<DraftListing | null> {
  if (!/^[0-9]{1,19}$/.test(toolId)) return null;
  if (!(await currentUserId())) return null;
  return asViewer(async (tx) => runMyDraft(tx, toolId, false));
}

/**
 * The slug and status of one of my listings, or null.
 *
 * The slug comes from HERE and never from a form (F12), and the status is how
 * the submit flow says "that listing is already published" without spending a
 * publish token to find out (F7).
 */
export async function myListing(toolId: string): Promise<MyListing | null> {
  if (!/^[0-9]{1,19}$/.test(toolId)) return null;
  if (!(await currentUserId())) return null;
  return asViewer(async (tx) => runMyListing(tx, toolId));
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
  | {
      ok: false;
      reason: 'refused' | 'duplicate' | 'invalid';
      message: string;
      detail?: string;
      /** Which control to point at, where the refusal names one. */
      field?: string;
    };

/** A refusal, narrowed so the caller can read `reason` without a guard. */
type Refusal = Extract<WriteOutcome<never>, { ok: false }>;

/**
 * A CHECK constraint, in English, with the field it is about.
 *
 * THE PHASE 7 REVIEW'S F2, SECOND HALF. A CHECK violation arrives as SQLSTATE
 * 23514 carrying PostgreSQL's own message — "new row for relation "tools"
 * violates check constraint "tools_url_check"" — and the first version of this
 * file showed it to the person. lib/submit.ts's header says a refusal is a
 * field and a sentence and never a stack trace; a constraint name is a stack
 * trace with better spelling.
 *
 * The distinction that makes this safe: a CHECK violation carries a
 * `constraint` property and a `raise ... using errcode` from one of 0017's
 * functions does not. So a sentence a function wrote — "a problem statement is
 * at most 200 characters; this one is 214" — is still shown as written, and
 * only the database's own wording is replaced.
 */
const CONSTRAINT_SENTENCES: Record<string, { field: string; message: string }> = {
  tools_url_check: {
    field: 'url',
    message: 'Only https addresses are stored, and the https:// has to be lower case.',
  },
  tools_name_is_clean: {
    field: 'name',
    message: 'That name has invisible characters in it. Retype it rather than pasting it.',
  },
  tools_summary_is_clean: {
    field: 'summary',
    message: 'That summary has invisible characters in it. Retype it rather than pasting it.',
  },
  tool_problems_statement_is_clean: {
    field: 'statements',
    message: 'One of those sentences has invisible characters in it. Retype it rather than pasting it.',
  },
  tools_summary_check: {
    field: 'summary',
    message: `A summary is between ${20} and ${400} characters.`,
  },
  tools_made_by_owner_is_not_claimable: {
    field: 'url',
    message: 'A listing somebody added themselves is not one anybody can claim.',
  },
};

/** The SQLSTATEs 0017's functions raise, and what each means to a person. */
function refusalOf(error: unknown): Refusal {
  const code = (error as { code?: string } | null)?.code ?? '';
  const message = (error as { message?: string } | null)?.message ?? '';
  const constraint = (error as { constraint?: string } | null)?.constraint ?? '';

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
  if (constraint) {
    // A CHECK, whatever its SQLSTATE. Our sentence, never PostgreSQL's.
    const known = CONSTRAINT_SENTENCES[constraint];
    if (known) {
      return { ok: false, reason: 'invalid', message: known.message, field: known.field };
    }
    console.error(`a maker's write hit an unmapped constraint (${constraint})`);
    return {
      ok: false,
      reason: 'invalid',
      message: 'One of those values is not one we can store. Check the form and try again.',
    };
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
 * A duplicate address comes back as `{ reason: 'duplicate' }` carrying the
 * existing listing's PUBLIC NAME and nothing else about it — a SENTENCE, which
 * is what the gate asks for and what the Phase 7 review found was an HTTP 500.
 * `runCreateDraft` holds the two guards that make it one; the address is
 * compared as `public.url_key`, so "already listed" is about the page rather
 * than about the exact bytes somebody typed.
 */
export async function createDraft(
  submission: Submission,
): Promise<WriteOutcome<{ id: string; slug: string }>> {
  const me = await currentUserId();
  if (!me) return { ok: false, reason: 'refused', message: 'Sign in to add a tool.' };

  return asViewer(async (tx) => {
    try {
      const created = await runCreateDraft(
        tx,
        [
          slugCandidates(submission.name),
          submission.name,
          submission.url,
          submission.summary,
          submission.pricing,
          submission.platforms,
          submission.languages,
          submission.flags,
          me,
        ],
        submission.url,
      );

      if (created.ok) return { ok: true, value: { id: created.id, slug: created.slug } };
      if (created.reason === 'refused') {
        return {
          ok: false,
          reason: 'refused',
          message: 'We could not create the listing. Try a slightly different name.',
        };
      }
      // The message names the existing listing, by its public name only. A
      // collision with an unpublished row comes back with no name at all.
      return created.name
        ? {
            ok: false,
            reason: 'duplicate',
            message: `We already list ${created.name}.`,
            detail: created.slug ?? undefined,
          }
        : {
            ok: false,
            reason: 'duplicate',
            message: 'That address is already listed.',
          };
    } catch (error) {
      return refusalOf(error);
    }
  });
}

/** Edit the six fields 0017 and 0018 grant UPDATE on. */
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

/**
 * Put the listing in one category, which is what /browse and /top read.
 *
 * Not folded into `updateListing`: it is a different table with its own policy,
 * and a failure here must not undo the eight columns that did save. A listing
 * with no category is a listing that publishes fine and never appears on
 * /browse, which is how the first version of this flow shipped.
 */
export async function setCategory(
  toolId: string,
  categorySlug: string,
): Promise<WriteOutcome<true>> {
  if (categorySlug.trim() === '') return { ok: true, value: true };
  return asViewer(async (tx) => {
    try {
      const { rows } = await tx.query(SET_CATEGORY_SQL, [toolId, categorySlug]);
      if (rows.length === 0) {
        return { ok: false, reason: 'refused', message: 'That category could not be set.' };
      }
      return { ok: true, value: true };
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
