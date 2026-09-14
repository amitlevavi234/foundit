/**
 * What a page shows where its data has not arrived yet — ResultsLoading.dc.html's
 * grammar, used everywhere.
 *
 * Every catalogue page is one round trip to PostgreSQL, and in development each
 * is also compiled on first visit. Without this, a click on "Browse" did
 * nothing visible until the whole page was ready, and a page that does nothing
 * for a second after a click reads as broken rather than busy.
 *
 * ---------------------------------------------------------------------------
 * IT IS A SUSPENSE FALLBACK INSIDE A PAGE NOW, AND NOT A `loading.tsx` — OWNER
 * FEEDBACK, ROUND 1, F2.
 *
 * `RouteLoading` used to draw a whole page — header, way back, skeleton — and
 * five routes exported it from their `loading.tsx`. Next compiles a
 * `loading.tsx` into a Suspense boundary around the WHOLE segment, so React
 * streamed this and sent the real page later inside `<div hidden id="S:n">`
 * with an inline script to swap it in. With scripting refused that script
 * never runs and the page stays on its skeleton for ever: four of the five
 * main routes showed a header and one line of text, and the search box, the
 * Save and Like forms, the review form, the fit scales and the stars were all
 * in the document and all invisible — under two comments in
 * `components/SearchField.tsx` claiming the opposite.
 *
 * So the whole-page version is gone and only the LINE is left. Each page now
 * renders its own shell synchronously and puts its data list in a Suspense
 * slot with this line and `SkeletonGrid` under it, which keeps the "something
 * is happening" frame exactly where it is honest — over the part that really
 * is still coming.
 */
export function LoadingLine({ label, detail }: { label: string; detail?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 8, flexWrap: 'wrap' }}>
      <span className="spinner" aria-hidden="true" />
      <span className="disp" style={{ fontSize: 22, fontWeight: 700 }} role="status">
        {label}
      </span>
      {detail ? (
        <span className="faint" style={{ fontSize: 'var(--t-meta)' }}>
          {detail}
        </span>
      ) : null}
    </div>
  );
}
