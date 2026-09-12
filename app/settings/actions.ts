'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { currentUserId, deleteAccount, updateProfile } from '@/lib/accounts';
import { normalizeHandle } from '@/lib/handle';

/* ===========================================================================
 * Settings — the two things a person can do to their own account.
 * ======================================================================== */

async function requireViewer(): Promise<void> {
  if (!(await currentUserId())) redirect('/sign-in?next=%2Fsettings');
}

/**
 * Save the profile.
 *
 * The handle is the only field that can fail, and it fails LOUDLY rather than
 * quietly becoming something else: `normalizeHandle` returns null for anything
 * the database's own CHECK would refuse, and the screen says so. Being
 * silently renamed is worse than being told no — the @name is how other people
 * find somebody, and a rename nobody noticed is a broken link on every review
 * they have written.
 */
export async function saveProfile(formData: FormData): Promise<void> {
  await requireViewer();

  const displayName = String(formData.get('displayName') ?? '');
  const bio = String(formData.get('bio') ?? '');
  const typedHandle = String(formData.get('handle') ?? '').trim();
  const handle = typedHandle === '' ? null : normalizeHandle(typedHandle);

  if (typedHandle !== '' && handle === null) redirect('/settings?problem=handle');

  let saved: string | null = null;
  try {
    saved = await updateProfile(displayName, bio, handle);
  } catch {
    // The one thing that can raise here is the unique index on handle. It is
    // not distinguishable from any other write failure without matching on a
    // message, and "that name is taken" is the only reading that helps.
    redirect('/settings?problem=taken');
  }

  revalidatePath('/settings');
  redirect(saved ? '/settings?saved=1' : '/settings?problem=save');
}

/**
 * Close the account.
 *
 * Everything about the ordering is in lib/deletion.ts. What is here is the
 * confirmation: a tick that has to be ticked, because this is the one control
 * in the product that cannot be undone by anybody, including us.
 */
export async function closeAccount(formData: FormData): Promise<void> {
  await requireViewer();
  if (String(formData.get('understood') ?? '') !== 'yes') redirect('/settings/delete?problem=tick');

  const outcome = await deleteAccount();
  if (!outcome) redirect('/sign-in');

  redirect('/sign-in?closed=1');
}
