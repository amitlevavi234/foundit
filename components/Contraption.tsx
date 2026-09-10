/**
 * The machine on the homepage: a sentence goes in at the top, tools come out
 * at the bottom. Traced from `contraption` in design/canvas/build.mjs.
 *
 * Two deliberate departures from the artboard, both for the same reason.
 *
 *   1. The request card at the top bobs but does not rotate.
 *   2. The three result cards drop in but do not rotate on the way.
 *
 * Both of those groups contain live SVG text, and rotating text is the thing
 * docs/product-decisions.md §9 rules out: a fractional angle renders type
 * against the pixel grid at a slant and it goes soft. The travel and the
 * timing are unchanged — see `bob-y` and `drop-y` in styles/motion.css. The
 * gear still spins, because there is not a word in it.
 *
 * Nothing here is an image, so there is nothing to load, nothing to shift when
 * it arrives, and no request to anybody.
 */
const CARD_LABELS: ReadonlyArray<readonly [x: number, delay: number, label: string, kind: string]> =
  [
    [292, 0, 'Bill splitter', 'coins'],
    [398, 1, 'Receipt scanner', 'receipt'],
    [504, 2, 'Trip budget', 'map'],
  ];

export function Contraption() {
  return (
    <svg
      viewBox="40 0 560 480"
      width={560}
      height={480}
      style={{ overflow: 'visible', maxWidth: '100%' }}
      role="img"
      aria-label="A machine: a described problem goes in at the top, matching tools come out at the bottom."
    >
      <defs>
        <clipPath id="contraption-window">
          <rect x="150" y="150" width="220" height="130" rx="18" />
        </clipPath>
      </defs>

      {/* The body, with its offset ink shadow drawn as a second shape. */}
      <rect x="96" y="126" width="330" height="240" rx="28" fill="var(--c-ink)" />
      <rect
        x="88"
        y="118"
        width="330"
        height="240"
        rx="28"
        fill="var(--c-tint)"
        stroke="var(--c-ink)"
        strokeWidth="3"
      />
      <path
        d="M170 118 L140 48 L370 48 L340 118 Z"
        fill="var(--c-surface)"
        stroke="var(--c-ink)"
        strokeWidth="3"
        strokeLinejoin="round"
      />

      {/* What somebody typed, going in. Translation only — see the note above. */}
      <g style={{ animation: 'bob-y 2.6s ease-in-out infinite' }}>
        <rect
          x="175"
          y="0"
          width="160"
          height="66"
          rx="10"
          fill="var(--c-surface)"
          stroke="var(--c-ink)"
          strokeWidth="3"
        />
        <text x="190" y="26" fontFamily="var(--font-body)" fontSize="13" fontWeight="500" fill="var(--c-ink)">
          split costs with
        </text>
        <text x="190" y="44" fontFamily="var(--font-body)" fontSize="13" fontWeight="500" fill="var(--c-ink)">
          friends, free, Spanish
        </text>
        <rect x="190" y="52" width="40" height="5" rx="2.5" fill="var(--c-coral)" />
      </g>

      <rect
        x="150"
        y="150"
        width="220"
        height="130"
        rx="18"
        fill="var(--c-surface)"
        stroke="var(--c-ink)"
        strokeWidth="3"
      />
      <g clipPath="url(#contraption-window)">
        <g style={{ transformOrigin: '260px 215px', animation: 'spin 6s linear infinite' }}>
          <circle cx="260" cy="215" r="52" fill="var(--c-violet)" stroke="var(--c-ink)" strokeWidth="3" />
          <path
            d="M260 163v104M208 215h104M223 178l74 74M297 178l-74 74"
            stroke="var(--c-ink)"
            strokeWidth="3"
          />
          <circle cx="260" cy="215" r="14" fill="var(--c-lime)" stroke="var(--c-ink)" strokeWidth="3" />
        </g>
      </g>

      <circle cx="118" cy="330" r="16" fill="var(--c-coral)" stroke="var(--c-ink)" strokeWidth="3" />

      <g style={{ transformOrigin: '440px 190px', animation: 'spin 3s linear infinite reverse' }}>
        <circle cx="440" cy="190" r="22" fill="var(--c-lime)" stroke="var(--c-ink)" strokeWidth="3" />
        <path d="M440 168v44M418 190h44" stroke="var(--c-ink)" strokeWidth="3" />
      </g>
      <rect x="418" y="200" width="6" height="90" fill="var(--c-ink)" />

      <path
        d="M300 358 L400 358 L440 400 L340 400 Z"
        fill="var(--c-surface)"
        stroke="var(--c-ink)"
        strokeWidth="3"
        strokeLinejoin="round"
      />

      {CARD_LABELS.map(([x, delay, label, kind]) => (
        <OutCard key={label} x={x} delay={delay} label={label} kind={kind} />
      ))}
    </svg>
  );
}

function OutCard({ x, delay, label, kind }: { x: number; delay: number; label: string; kind: string }) {
  return (
    <g style={{ animation: `drop-y 3s var(--ease-spring) ${delay}s infinite` }}>
      <rect x={x + 3} y="399" width="100" height="74" rx="12" fill="var(--c-ink)" />
      <rect
        x={x}
        y="396"
        width="100"
        height="74"
        rx="12"
        fill="var(--c-surface)"
        stroke="var(--c-ink)"
        strokeWidth="3"
      />
      <g transform={`translate(${x + 10}, 404) scale(.85)`}>
        <Glyph kind={kind} />
      </g>
      <text
        x={x + 10}
        y="449"
        fontFamily="var(--font-display)"
        fontWeight="700"
        fontSize="12"
        fill="var(--c-ink)"
      >
        {label}
      </text>
      <text x={x + 10} y="463" fontFamily="var(--font-body)" fontWeight="500" fontSize="10.5" fill="var(--c-muted)">
        fits your ask
      </text>
    </g>
  );
}

/**
 * The artboard puts a fit number in a lime badge on each of these cards. There
 * is no honest number to put there — `score` is an ordering value and Phase 5
 * owns the calibration — so the badge is not drawn rather than drawn with an
 * invented 92 in it.
 */
function Glyph({ kind }: { kind: string }) {
  const ring = (
    <circle cx="16" cy="16" r="14" fill="var(--c-tint)" stroke="var(--c-ink)" strokeWidth="2.5" />
  );

  if (kind === 'coins') {
    return (
      <>
        {ring}
        <circle cx="13" cy="16" r="6" fill="var(--c-coral)" stroke="var(--c-ink)" strokeWidth="2.5" />
        <circle cx="20" cy="16" r="6" fill="var(--c-lime)" stroke="var(--c-ink)" strokeWidth="2.5" />
      </>
    );
  }

  if (kind === 'receipt') {
    return (
      <>
        {ring}
        <path
          d="M10 8h12v16l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z"
          fill="var(--c-surface)"
          stroke="var(--c-ink)"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <path d="M13 13h6M13 17h4" stroke="var(--c-ink)" strokeWidth="2" />
      </>
    );
  }

  return (
    <>
      {ring}
      <path
        d="M16 25s-6-5.4-6-10a6 6 0 0 1 12 0c0 4.6-6 10-6 10z"
        fill="var(--c-violet)"
        stroke="var(--c-ink)"
        strokeWidth="2.3"
      />
      <circle cx="16" cy="15" r="2.2" fill="var(--c-surface)" />
    </>
  );
}
