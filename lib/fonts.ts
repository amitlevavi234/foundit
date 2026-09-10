import { Bricolage_Grotesque, Onest } from 'next/font/google';

/**
 * Bricolage Grotesque for display, Onest for interface — docs/product-decisions.md §9.
 *
 * Loaded through `next/font`, which self-hosts both files from our own origin
 * and emits a size-adjusted local fallback, so the page does not reflow when
 * the real faces arrive. Nothing here reaches out to fonts.googleapis.com at
 * request time; the download happens once, at build time.
 *
 * Both are loaded as variable fonts. `.disp` sets `font-variation-settings:
 * 'opsz' 96, 'wdth' 100`, so the optical-size and width axes have to come
 * along with the weight axis.
 */
export const displayFont = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  axes: ['opsz', 'wdth'],
  variable: '--font-bricolage',
  fallback: ['Segoe UI', 'system-ui', 'sans-serif'],
});

export const bodyFont = Onest({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-onest',
  fallback: ['Segoe UI', 'system-ui', 'sans-serif'],
});

export const fontClassNames = `${displayFont.variable} ${bodyFont.variable}`;
