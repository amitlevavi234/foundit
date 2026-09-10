import Link from 'next/link';

/**
 * The mark: a speech bubble that found something.
 * Traced from `mark()` in design/canvas/build.mjs. The ink copy underneath is
 * the offset shadow, drawn as a second path rather than a filter — there are
 * no blur filters anywhere in this interface.
 */
export function Mark({ size = 34 }: { size?: number }) {
  const bubble = 'M19 5a14 14 0 1 1-8.2 25.3L5 35l1.6-8.9A14 14 0 0 1 19 5z';
  const sparks = 'M31.5 9.5l3.2-4.2M35 15.5l4.8-1.2M28.5 5.5l.4-4.6';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{ flex: 'none', overflow: 'visible' }}
      aria-hidden="true"
      focusable="false"
    >
      <path d={bubble} transform="translate(2.4,2.4)" fill="var(--c-ink)" />
      <path
        d={bubble}
        fill="var(--c-coral)"
        stroke="var(--c-ink)"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="19" cy="19" r="6.6" fill="var(--c-bg)" stroke="var(--c-ink)" strokeWidth="2.2" />
      <circle cx="19" cy="19" r="2.7" fill="var(--c-violet)" />
      <path d={sparks} stroke="var(--c-ink)" strokeWidth="2.4" strokeLinecap="round" />
      <path d={sparks} stroke="var(--c-lime)" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The wordmark. `size` is the type size; the mark scales with it at the ratio
 * the artboards use (1.13x), so the pair stays balanced at any size.
 */
export function Wordmark({ size = 30, href = '/' }: { size?: number; href?: string }) {
  return (
    <Link href={href} className="wordmark" style={{ fontSize: size }}>
      <Mark size={Math.round(size * 1.13)} />
      <span>
        Found<span className="it">it</span>
      </span>
    </Link>
  );
}
