'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { currentUserId } from '@/lib/accounts';
import {
  claimListing,
  createDraft,
  myDraft,
  myListing,
  publishListing,
  setCategory,
  setStatements,
  updateListing,
} from '@/lib/maker';
import { allowEdit, allowPublish } from '@/lib/rate-limit';
import {
  STATEMENTS_MAX,
  checkDraftBasics,
  checkEvidenceUrl,
  checkSubmission,
  checkUrl,
  cleanText,
} from '@/lib/submit';
import { visitorAddress } from '@/lib/visitor';

/* ===========================================================================
 * The six steps, the claim, and the edit.
 *
 * WHERE THE IN-PROGRESS SUBMISSION LIVES, and why it moves halfway through.
 *
 *   Steps 1 and 2 — the tick and the address — live in one httpOnly cookie.
 *   They have to live somewhere that is not the catalogue, because
 *   `tools.summary` carries a 20-character CHECK from 0001 and there is nothing
 *   honest to put in it before somebody has written one. Inventing a
 *   placeholder summary so that a row could exist earlier would put a sentence
 *   nobody wrote into the column search matches against.
 *
 *   From step 3 the draft is a real row, and every later step is an ordinary
 *   authorised write against it. That is when the artboards' "Draft saved,
 *   continue anytime" becomes true, and `components/SubmitSteps.tsx` only
 *   draws it from there on.
 *
 * The cookie holds a boolean and a URL. It is httpOnly, so no script reads it;
 * it is not signed, and it does not need to be — forging it gets somebody to
 * step 3 with an address of their choosing, which is what typing the address
 * does. The tick is re-asserted at the insert and at the publish, where it is
 * not a cookie but a column the database stamps
 * (`public.tools_stamp_submission`).
 *
 * THE TICK IS CHECKED THREE TIMES. In the HTML, where Continue is `disabled`
 * and the checkbox is `required`; here, where a POST without it is refused with
 * the tick's own sentence; and in the database, where `made_by_owner` is not a
 * column the application may write at all and is stamped true because in this
 * version there is no other kind of submission (docs/product-decisions.md §3).
 *
 * NOTHING HERE FETCHES THE SUBMITTED URL. Not to read the page, not for a
 * favicon, not a HEAD request to see whether it resolves.
 * docs/product-decisions.md §12 draws the line and tests/markup.test.mjs pins
 * the three files that may call `fetch`. The SubmitURL artboard's "Read the
 * page" button checks the address and moves on, and the screen says that is
 * what it does.
 *
 * EVERY WRITE THAT CHANGES THE CATALOGUE CALLS revalidateTag('catalogue').
 * lib/db.ts asked the first writer to remember: the homepage, browse, /top and
 * every tool page are cached for a minute as the anonymous view, so without
 * this a person publishes a listing and cannot find it for up to sixty
 * seconds — which reads as the embedding queue being slow and is not.
 * ======================================================================== */

const COOKIE = 'foundit_submit';

interface Started {
  made: boolean;
  url: string;
}

async function readStarted(): Promise<Started> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return { made: false, url: '' };
  try {
    const parsed = JSON.parse(raw) as Partial<Started>;
    return { made: parsed.made === true, url: cleanText(parsed.url) };
  } catch {
    return { made: false, url: '' };
  }
}

async function writeStarted(value: Started): Promise<void> {
  (await cookies()).set(COOKIE, JSON.stringify(value), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/submit',
    // An hour. Long enough to go and find the address, short enough that a
    // shared machine does not hand the next person a half-filled form.
    maxAge: 60 * 60,
    secure: process.env.NODE_ENV === 'production',
  });
}

async function clearStarted(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Sign-in first, and come back to the step they were on. */
async function requireSignIn(next: string): Promise<string> {
  const me = await currentUserId();
  if (!me) redirect(`/sign-in?next=${encodeURIComponent(next)}&intent=submit`);
  return me;
}

/* ===========================================================================
 * Step 1 — "Yes, I made this tool"
 * ======================================================================== */

export async function agreeToMake(formData: FormData): Promise<void> {
  await requireSignIn('/submit');

  if (String(formData.get('made') ?? '') !== 'yes') {
    // The tick's own message, not a generic one. docs/product-decisions.md §3:
    // "users may only add tools they made themselves", and the alternative
    // route — telling us about somebody else's — is on the page already.
    redirect('/submit?problem=tick');
  }

  await writeStarted({ made: true, url: '' });
  redirect('/submit/url');
}

/* ===========================================================================
 * Step 2 — where it lives
 * ======================================================================== */

export async function setSubmitUrl(formData: FormData): Promise<void> {
  await requireSignIn('/submit/url');
  const started = await readStarted();
  if (!started.made) redirect('/submit?problem=tick');

  const url = cleanText(formData.get('url'));
  const problem = checkUrl(url);
  if (problem) {
    redirect(`/submit/url?problem=${encodeURIComponent(problem.message)}&url=${encodeURIComponent(url)}`);
  }

  await writeStarted({ made: true, url });
  redirect('/submit/details');
}

/* ===========================================================================
 * Step 3 — the basics, and the row
 * ======================================================================== */

export async function createListing(formData: FormData): Promise<void> {
  await requireSignIn('/submit/details');
  const started = await readStarted();
  if (!started.made) redirect('/submit?problem=tick');
  if (started.url === '') redirect('/submit/url');

  const name = cleanText(formData.get('name'));
  const summary = cleanText(formData.get('summary'));

  const basics = checkDraftBasics({ name, url: started.url, summary });
  const firstBasic = basics.problems[0];
  if (firstBasic) {
    redirect(
      `/submit/details?problem=${encodeURIComponent(firstBasic.message)}`
        + `&field=${firstBasic.field}`
        + `&name=${encodeURIComponent(name)}&summary=${encodeURIComponent(summary)}`,
    );
  }

  // Pricing, platforms, languages and flags are step 4's; the row is created
  // with the database's own defaults for them and `pricing = 'free'`, which is
  // NOT NULL and has to be something. The Preview step refuses to publish a
  // listing that still has no platform, so the default cannot ship by accident.
  const created = await createDraft({
    ...basics.value,
    pricing: 'free',
    platforms: [],
    languages: [],
    flags: [],
    statements: [],
  });

  if (!created.ok) {
    if (created.reason === 'duplicate') {
      redirect(
        `/submit/url?duplicate=${encodeURIComponent(created.message)}`
          + (created.detail ? `&listing=${encodeURIComponent(created.detail)}` : '')
          + `&url=${encodeURIComponent(started.url)}`,
      );
    }
    redirect(
      `/submit/details?problem=${encodeURIComponent(created.message)}`
        + (created.field ? `&field=${created.field}` : '')
        + `&name=${encodeURIComponent(name)}&summary=${encodeURIComponent(summary)}`,
    );
  }

  // The category is a second statement on a second table with its own policy,
  // and it is not optional: /browse and /top are organised by category, so a
  // listing without one publishes fine and appears on neither. The first
  // version of this flow left the artboard's select out and that is exactly
  // what happened.
  await setCategory(created.value.id, cleanText(formData.get('category')));

  redirect(`/submit/problems?draft=${created.value.id}`);
}

/* ===========================================================================
 * Step 4 — what problems it solves
 * ======================================================================== */

function statementsFrom(formData: FormData): string[] {
  const out: string[] = [];
  for (let n = 0; n < STATEMENTS_MAX; n += 1) {
    const value = cleanText(formData.get(`statement${n}`));
    if (value !== '') out.push(value);
  }
  return out;
}

/**
 * The sentence a person sees when they have saved too many times in an hour.
 *
 * One place, because `setProblems` and `saveListing` are the same limit and
 * the same explanation, and a limit that is explained two slightly different
 * ways on two screens is a limit somebody will eventually describe wrongly.
 */
function editRefusal(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return (
    'That is a lot of saves in one hour. Nothing is lost — the listing is as you last saved it '
    + `and saving works again in about ${minutes} minute${minutes === 1 ? '' : 's'}. `
    + 'Every save re-reads the sentences that changed, which costs something, so there is a ceiling on it.'
  );
}

export async function setProblems(formData: FormData): Promise<void> {
  const draft = cleanText(formData.get('draft'));
  const me = await requireSignIn(`/submit/problems?draft=${draft}`);

  const statements = statementsFrom(formData);
  if (statements.length === 0) {
    redirect(
      `/submit/problems?draft=${draft}`
        + `&problem=${encodeURIComponent('Describe at least one problem it solves — this is what people search for.')}`,
    );
  }

  // EVERY STATEMENT EDIT QUEUES AN EMBEDDING, and until the Phase 7 review
  // nothing bounded how often. `allowPublish` was called in `publishDraft` and
  // nowhere else, so one account could rewrite one listing's sentences in a
  // loop; the review did it fifty times. docs/product-decisions.md §19.
  const allowance = allowEdit(me);
  if (!allowance.allowed) {
    redirect(
      `/submit/problems?draft=${draft}`
        + `&problem=${encodeURIComponent(editRefusal(allowance.retryAfterSeconds))}`,
    );
  }

  const written = await setStatements(draft, statements);
  if (!written.ok) {
    redirect(`/submit/problems?draft=${draft}&problem=${encodeURIComponent(written.message)}`);
  }

  redirect(`/submit/constraints?draft=${draft}`);
}

/* ===========================================================================
 * Step 5 — what is true about it today
 * ======================================================================== */

export async function setConstraints(formData: FormData): Promise<void> {
  const draft = cleanText(formData.get('draft'));
  await requireSignIn(`/submit/constraints?draft=${draft}`);

  // The name and the summary come from the row rather than from the form,
  // because this screen does not draw them and UPDATE_LISTING_SQL writes all
  // six columns in one statement. Reading them back first is what stops a
  // screen that edits the pricing from blanking the summary.
  const existing = await myDraft(draft);
  if (!existing) redirect('/maker');

  const checked = checkSubmission({
    name: existing.name,
    url: existing.url,
    summary: existing.summary,
    pricing: cleanText(formData.get('pricing')),
    platforms: formData.getAll('platforms').map(String),
    languages: formData.getAll('languages').map(String),
    flags: formData.getAll('flags').map(String),
    statements: existing.statements,
  });

  // Only this screen's own fields are worth refusing here: the others were
  // checked at their own step and a person sent back to fix a summary from the
  // constraints screen has no summary field to fix it in.
  const mine = checked.problems.filter(
    (problem) => problem.field === 'pricing' || problem.field === 'platforms',
  )[0];
  if (mine) {
    redirect(`/submit/constraints?draft=${draft}&problem=${encodeURIComponent(mine.message)}`);
  }

  const saved = await updateListing(draft, checked.value);
  if (!saved.ok) {
    redirect(`/submit/constraints?draft=${draft}&problem=${encodeURIComponent(saved.message)}`);
  }

  redirect(`/submit/preview?draft=${draft}`);
}

/* ===========================================================================
 * Step 6 — publish
 * ======================================================================== */

export async function publishDraft(formData: FormData): Promise<void> {
  const draft = cleanText(formData.get('draft'));
  const me = await requireSignIn(`/submit/preview?draft=${draft}`);

  if (String(formData.get('accurate') ?? '') !== 'yes') {
    redirect(`/submit/preview?draft=${draft}&problem=accuracy`);
  }

  // `myDraft` is DRAFTS ONLY since the Phase 7 review. A listing that is
  // already live is not "not there": it is a thing worth saying, and saying it
  // here is what stops a double-click, a browser resubmit or a
  // back-button-and-retry from spending a publish token on a no-op. The review
  // replayed this form five times against a published listing and watched two
  // of three daily publishes go on publishes that did nothing, followed by an
  // eight-hour refusal.
  const listing = await myDraft(draft);
  if (!listing) {
    const row = await myListing(draft);
    if (row && row.status !== 'draft') {
      redirect(
        `/maker/${row.slug}?published=1`,
      );
    }
    redirect('/maker');
  }

  // The whole submission, checked as one thing for the first time. Every
  // earlier step checked its own fields; this is the one that refuses a
  // listing with no platform or no problem statement, which are the two a
  // person can reach the end without having given.
  const checked = checkSubmission(listing);
  const gap = checked.problems[0];
  if (gap) {
    redirect(`/submit/preview?draft=${draft}&problem=${encodeURIComponent(gap.message)}`);
  }

  // THE LIMIT IS SPENT HERE AND NOT EARLIER. A draft costs nothing and is
  // invisible to everybody; refusing one would mean a person loses the form
  // they filled in. docs/product-decisions.md §19.
  //
  // IT IS PEEKED HERE AND CHARGED AFTER THE PUBLISH SUCCEEDS. A refusal from
  // `publish_tool` — a listing already live, a listing with no statement, a
  // listing that is not yours — used to cost one of the three a person gets
  // for the day, which is a ceiling on the catalogue charging for things that
  // never reached it. The peek is still first because the refusal page has to
  // come before the write, and the token is taken at the moment there is
  // something to take it for.
  const address = await visitorAddress();
  const allowance = allowPublish(me, address, { peek: true });
  if (!allowance.allowed) {
    redirect(
      `/submit/preview?draft=${draft}&refused=${allowance.refusedBy}`
        + `&wait=${allowance.retryAfterSeconds}`,
    );
  }

  const published = await publishListing(draft);
  if (!published.ok) {
    redirect(`/submit/preview?draft=${draft}&problem=${encodeURIComponent(published.message)}`);
  }

  // It is in the catalogue. Now it costs one.
  allowPublish(me, address);

  await clearStarted();

  // The catalogue caches are a minute old and this listing is not in them.
  revalidateTag('catalogue');
  revalidatePath('/');
  revalidatePath('/browse');
  revalidatePath('/top');
  revalidatePath(`/tools/${published.value}`);

  redirect(`/submit/done?tool=${encodeURIComponent(published.value)}`);
}

/* ===========================================================================
 * Claiming — ClaimTool.dc.html
 * ======================================================================== */

export async function claimTool(formData: FormData): Promise<void> {
  const slug = cleanText(formData.get('slug'));
  const toolId = cleanText(formData.get('tool'));
  await requireSignIn(`/claim?tool=${encodeURIComponent(slug)}`);

  const evidence = cleanText(formData.get('evidence'));
  const problem = checkEvidenceUrl(evidence);
  if (problem) {
    redirect(
      `/claim?tool=${encodeURIComponent(slug)}&problem=${encodeURIComponent(problem.message)}`
        + `&evidence=${encodeURIComponent(evidence)}`,
    );
  }

  const claimed = await claimListing(toolId, evidence === '' ? null : evidence);
  if (!claimed.ok) {
    redirect(
      `/claim?tool=${encodeURIComponent(slug)}&problem=${encodeURIComponent(claimed.message)}`,
    );
  }

  // "Maintained by @handle" is on the tool page, which is cached.
  revalidateTag('catalogue');
  revalidatePath(`/tools/${claimed.value}`);
  redirect(`/maker/${claimed.value}`);
}

/* ===========================================================================
 * Editing — EditListing.dc.html
 * ======================================================================== */

export async function saveListing(formData: FormData): Promise<void> {
  // The slug off the FORM is used for one thing only: the address to send
  // somebody back to while they are still being refused. Everything that
  // depends on which row was written — the revalidations and the redirect at
  // the end — reads the slug off the ROW. F12: a signed-in person editing
  // their own listing could name any slug in the same POST and purge that
  // path's cache, which is a cache miss for somebody else's page rather than a
  // read or a write, and the slug never needed to come from the request.
  const typed = cleanText(formData.get('slug'));
  const toolId = cleanText(formData.get('tool'));
  const me = await requireSignIn(`/maker/${typed}/edit`);

  // The same ceiling as the submit flow's statements step, and the same
  // sentence. F4: nothing bounded how often a listing could be rewritten, and
  // every statement edit writes a row to public.embedding_jobs.
  const allowance = allowEdit(me);
  if (!allowance.allowed) {
    redirect(
      `/maker/${typed}/edit?problem=${encodeURIComponent(editRefusal(allowance.retryAfterSeconds))}`,
    );
  }

  const checked = checkSubmission({
    name: formData.get('name'),
    // The address is not editable — it is not in 0017's UPDATE column list and
    // is not drawn on the EditListing artboard — so it comes from the row and
    // is passed only so the whole-submission check has something to check.
    url: cleanText(formData.get('url')),
    summary: formData.get('summary'),
    pricing: cleanText(formData.get('pricing')),
    platforms: formData.getAll('platforms').map(String),
    languages: formData.getAll('languages').map(String),
    flags: formData.getAll('flags').map(String),
    statements: statementsFrom(formData),
  });

  const wrong = checked.problems[0];
  if (wrong) {
    redirect(
      `/maker/${typed}/edit?problem=${encodeURIComponent(wrong.message)}`
        + `&field=${wrong.field}`,
    );
  }

  // WHICH ROW IS ABOUT TO BE WRITTEN, and what it is called. `tool_is_mine` in
  // the database is what decides, exactly as it decides the UPDATE below; this
  // asks it for the name of the thing rather than believing the form.
  const row = await myListing(toolId);
  if (!row) {
    redirect(
      `/maker/${typed}/edit?problem=${encodeURIComponent('That listing is not yours to change.')}`,
    );
  }
  const slug = row.slug;

  const saved = await updateListing(toolId, checked.value);
  if (!saved.ok) {
    redirect(
      `/maker/${slug}/edit?problem=${encodeURIComponent(saved.message)}`
        + (saved.field ? `&field=${saved.field}` : ''),
    );
  }

  // Two statements rather than one, because they are two different writes with
  // two different rules: the six columns go through the UPDATE policy, and
  // the statements go through public.set_owner_statements. The second one is
  // also what re-queues the embeddings that changed — a statement whose text
  // is identical keeps its row, its vector and its provenance, and one whose
  // text changed keeps its ROW and loses its vector (0018), so fifty edits are
  // one queued job rather than fifty.
  const statements = await setStatements(toolId, checked.value.statements);
  if (!statements.ok) {
    redirect(
      `/maker/${slug}/edit?problem=${encodeURIComponent(statements.message)}`
        + (statements.field ? `&field=${statements.field}` : ''),
    );
  }

  const category = cleanText(formData.get('category'));
  if (category !== '') await setCategory(toolId, category);

  revalidateTag('catalogue');
  revalidatePath('/');
  revalidatePath('/browse');
  revalidatePath('/top');
  revalidatePath(`/tools/${slug}`);
  revalidatePath(`/maker/${slug}`);

  redirect(`/maker/${slug}?saved=1`);
}
