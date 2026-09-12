'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  createCollection,
  currentUserId,
  deleteCollection,
  saveTool,
  shareCollection,
  unsaveTool,
  unshareCollection,
} from '@/lib/accounts';

/* ===========================================================================
 * What a person does to their own saved lists.
 *
 * Every one of these is a form post. None of them checks whether the
 * collection belongs to the person doing it, because that is not the
 * application's job: the statement runs under their identity and
 * `collections_write` — `owner_id = auth.uid()` — is what decides. A refused
 * write affects no rows and the screen re-renders unchanged, which is the same
 * thing the person sees if they invented an id in the form.
 *
 * `revalidatePath` rather than `revalidateTag('catalogue')`: saving something
 * changes `tools.save_count`, which IS catalogue data, but it changes it by
 * one on one row and the catalogue cache is a minute long. What has to be
 * fresh immediately is the person's own page, and that is not cached at all.
 * ======================================================================== */

/** Nothing on these screens is reachable signed out, and the policies agree. */
async function requireViewer(): Promise<void> {
  if (!(await currentUserId())) redirect('/sign-in?next=%2Fsaved');
}

export async function newCollection(formData: FormData): Promise<void> {
  await requireViewer();
  const name = String(formData.get('name') ?? '');
  const slug = await createCollection(name, String(formData.get('description') ?? ''));
  revalidatePath('/saved');
  redirect(slug ? `/saved/${slug}` : '/saved');
}

export async function removeCollection(formData: FormData): Promise<void> {
  await requireViewer();
  await deleteCollection(String(formData.get('id') ?? ''));
  revalidatePath('/saved');
  redirect('/saved');
}

/** Turn sharing on and land on the collection, where the link is shown. */
export async function startSharing(formData: FormData): Promise<void> {
  await requireViewer();
  const slug = String(formData.get('slug') ?? '');
  await shareCollection(String(formData.get('id') ?? ''));
  revalidatePath('/saved');
  redirect(slug ? `/saved/${slug}?shared=1` : '/saved');
}

/** Revoke it. The old link stops opening anything the moment this returns. */
export async function stopSharing(formData: FormData): Promise<void> {
  await requireViewer();
  const slug = String(formData.get('slug') ?? '');
  await unshareCollection(String(formData.get('id') ?? ''));
  revalidatePath('/saved');
  redirect(slug ? `/saved/${slug}` : '/saved');
}

export async function removeSaved(formData: FormData): Promise<void> {
  await requireViewer();
  const collectionId = String(formData.get('collectionId') ?? '');
  const slug = String(formData.get('slug') ?? '');
  const back = String(formData.get('back') ?? '/saved');
  await unsaveTool(collectionId, slug);
  revalidatePath(back.startsWith('/saved') ? back : '/saved');
  redirect(back.startsWith('/saved') ? back : '/saved');
}

/**
 * Save a tool into a collection, from anywhere.
 *
 * `back` is where the person was — a result page, a tool page — and they are
 * returned to it, which is the whole of what the gate promises: signing in or
 * saving puts you back where you were doing it.
 */
export async function saveToCollection(formData: FormData): Promise<void> {
  await requireViewer();
  const slug = String(formData.get('slug') ?? '');
  const back = String(formData.get('back') ?? `/tools/${slug}`);
  let collectionId = String(formData.get('collectionId') ?? '');

  // "New collection…" from the save menu: make it, then save into it.
  if (collectionId === 'new') {
    const name = String(formData.get('newName') ?? '').trim() || 'Saved';
    const created = await createCollection(name);
    collectionId = created ? await idOfSlug(created) : '';
  }

  if (collectionId) await saveTool(collectionId, slug, String(formData.get('note') ?? ''));
  revalidatePath(back.startsWith('/') ? back : '/saved');
  redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/saved');
}

/** The id behind a slug, for the one path that creates and saves in one go. */
async function idOfSlug(slug: string): Promise<string> {
  const { getSaved } = await import('@/lib/accounts');
  const saved = await getSaved(slug);
  return saved.chosen?.id ?? '';
}
