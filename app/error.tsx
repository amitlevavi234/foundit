'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { Button } from '@/components/Button';
import { Mark } from '@/components/Logo';

/**
 * Something broke. From ErrorPage.dc.html.
 *
 * It says nothing about what was searched for. Whatever went wrong, the query
 * text does not appear on the page, in the digest, or in anything this
 * component reports — that is the same promise `search_events` makes, and an
 * error path is exactly where it usually gets broken.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is a server-side identifier with no request content in it.
    // Nothing else from `error` is safe to print here.
    if (error.digest) {
      console.error(`Foundit: render failed (digest ${error.digest}).`);
    }
  }, [error.digest]);

  return (
    <main
      className="page"
      style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 20 }}
    >
      <Mark size={56} />
      <h1 className="disp" style={{ fontSize: 36, margin: '14px 0 0' }}>
        That didn’t work.
      </h1>
      <p className="muted" style={{ maxWidth: 460, margin: 0, lineHeight: 'var(--lh-body)' }}>
        Something on our side fell over. Nothing you typed was lost and nothing about it was
        recorded against you.
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <Button variant="coral" onClick={reset}>
          Try again
        </Button>
        <Link className="btn" href="/">
          Start over
        </Link>
      </div>
    </main>
  );
}
