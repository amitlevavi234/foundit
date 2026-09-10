/**
 * The card-shaped placeholder from ResultsLoading.dc.html and the dimmed grid
 * behind the clarifier.
 *
 * It holds the exact space a result card will take, so nothing on the page
 * moves when the answer arrives. There is no text in it at all: a skeleton
 * with words in it is a sentence somebody reads and then has to unread.
 */
export function SkeletonCard({ delay = 0 }: { delay?: number }) {
  return (
    <div className="card rise skel" style={{ animationDelay: `${delay}ms` }} aria-hidden="true">
      <div className="skel-line" />
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <span className="skel-block" style={{ width: 48, height: 48, borderRadius: 12 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="skel-block" style={{ height: 18, width: '40%', borderRadius: 6 }} />
          <span className="skel-block" style={{ height: 12, width: '80%', borderRadius: 6 }} />
        </div>
      </div>
      <div className="skel-block" style={{ height: 64 }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <span className="skel-pill" style={{ width: 70 }} />
        <span className="skel-pill" style={{ width: 120 }} />
        <span className="skel-pill" style={{ width: 90 }} />
      </div>
    </div>
  );
}

/** The three of them, as both loading screens draw them. */
export function SkeletonGrid({ count = 3, dimmed = false }: { count?: number; dimmed?: boolean }) {
  return (
    <div className="results-grid" style={dimmed ? { opacity: 0.6 } : undefined}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} delay={100 + i * 90} />
      ))}
    </div>
  );
}
