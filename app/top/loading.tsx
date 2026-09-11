import { RouteLoading } from '@/components/RouteLoading';

/** Shown the instant a link to /top is followed. See components/RouteLoading.tsx. */
export default function TopLoading() {
  return (
    <RouteLoading
      label="Counting what people found useful…"
      detail="Ranked by likes and saves, nothing bought"
      active="top"
      back={{ href: '/', label: 'Home' }}
    />
  );
}
