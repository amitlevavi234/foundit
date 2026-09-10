import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { fontClassNames } from '@/lib/fonts';

import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/motion.css';
import '@/styles/components.css';

export const metadata: Metadata = {
  title: {
    default: 'Foundit — say what’s bugging you, we’ll find the tool',
    template: '%s · Foundit',
  },
  description:
    'Describe a problem in plain language and get the tools that actually solve it, ranked by how well they fit, with the reasons.',
  applicationName: 'Foundit',
  // No referrer leaves this origin. A referrer header on the way out would
  // carry the search query — which is the one thing that must never travel.
  referrer: 'no-referrer',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#FFFCF5',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontClassNames}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
