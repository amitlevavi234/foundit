import type { CSSProperties } from 'react';

/**
 * The stand-in mark for a tool: its initial on a tinted square with an ink
 * border, exactly the `tile()` helper in design/canvas/build.mjs.
 *
 * Deliberately not a favicon. Fetching one would mean our server requesting a
 * URL a stranger typed into a form, which is the thing this codebase must
 * never do. A letter on a colour is enough to tell three results apart in a
 * grid, and it costs no request at all.
 *
 * The colour is chosen from the slug, so a tool keeps the same tile on every
 * page it appears on without anyone storing a choice.
 */
const PALETTE: ReadonlyArray<readonly [bg: string, fg: string]> = [
  ['#DCEBE3', '#1F5A48'],
  ['#DFE6F2', '#2E4A7A'],
  ['#F4E4D3', '#8A4E1C'],
  ['#F3E3E1', '#8A3A32'],
  ['#E3ECF3', '#264E6E'],
  ['#F6E9D6', '#7A5216'],
  ['#EDE4F3', '#5E3A80'],
  ['#EAE6F1', '#4E3F78'],
  ['#E8EFE4', '#3A5E2B'],
  ['#E6EEF7', '#1F4E7A'],
  ['#E5E9F5', '#2A3A7A'],
];

/** A small, stable, non-cryptographic hash. Same slug, same colour, forever. */
export function tilePaletteIndex(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return h % PALETTE.length;
}

/**
 * One letter for a one-word name, two for a name in several words. Eleven
 * colours cannot keep every pair apart — "Splid" and "Settle Up" can land on
 * the same one — so the letters do the work the colour cannot. The tile is a
 * way to tell three results apart at a glance, never an identifier.
 */
export function tileInitial(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]!.charAt(0).toUpperCase();
  if (words.length === 1) return first;
  return first + words[1]!.charAt(0).toUpperCase();
}

export interface ToolTileProps {
  name: string;
  /** What the colour is chosen from. Defaults to the name. */
  slug?: string;
  size?: number;
  style?: CSSProperties;
}

export function ToolTile({ name, slug, size = 48, style }: ToolTileProps) {
  const pair = PALETTE[tilePaletteIndex(slug ?? name)] ?? PALETTE[0]!;
  const [bg, fg] = pair;

  return (
    <span
      className="tile"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.46),
        borderRadius: Math.round(size * 0.25),
        ...style,
      }}
    >
      {tileInitial(name)}
    </span>
  );
}
