import Link from 'next/link';

import { Mark } from '@/components/Logo';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

export default function NotFound() {
  return (
    <div className="page">
      <SiteHeader />
      <main
        id="main"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 16,
          padding: '24px 24px 80px',
        }}
      >
        <Mark size={56} />
        <h1 className="disp" style={{ fontSize: 36, margin: '14px 0 0' }}>
          Nothing here.
        </h1>
        <p className="muted" style={{ maxWidth: 440, margin: 0, lineHeight: 'var(--lh-body)' }}>
          This page doesn’t exist, or it did once and doesn’t now.
        </p>
        <Link href="/" className="btn btn-coral">
          Describe a problem instead
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
