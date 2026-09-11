import { RouteLoading } from '@/components/RouteLoading';

/** Shown the instant a link to /browse is followed. See components/RouteLoading.tsx. */
export default function BrowseLoading() {
  return (
    <RouteLoading
      label="Opening the catalogue…"
      detail="Problems people solve here, one per tool"
      active="browse"
      back={{ href: '/', label: 'Home' }}
    />
  );
}
