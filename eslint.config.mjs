import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    // Everything that is not the web application. `db/`, `eval/` and
    // `research/` belong to other phases and are not ours to reformat.
    ignores: [
      '.next/**',
      'node_modules/**',
      'db/**',
      'design/**',
      'docs/**',
      'eval/**',
      'research/**',
      'server/**',
      'scripts/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // A tool URL is typed by a maker. It is rendered as a link and never
      // fetched, optimised or proxied by us, so `next/image` is not an option
      // for it and this rule would push us the wrong way. Local, first-party
      // images still use next/image by choice.
      '@next/next/no-img-element': 'off',
    },
  },
  {
    // Tests run under `node --test` with Node's own type stripping, so they
    // import TypeScript by its real extension.
    files: ['tests/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];

export default config;
