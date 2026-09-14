'use client';

import { useId, useState } from 'react';

import { Icon } from './Icon';
import { MAX_QUERY_LENGTH } from '@/lib/sql';

/**
 * The one input the product has: "Say what's bugging you."
 *
 * A slab with the send button parked inside it, from the homepage artboard.
 * It is a plain `<form method="get">`, so it works with JavaScript switched off
 * and the result is a shareable URL.
 *
 * IT IS A SINGLE-LINE `<input>` AND IT USED TO BE A `<textarea>` — the owner's
 * item 7, 14 September 2026. A `<textarea>` does not submit on Enter; a script
 * had to make it, with `onKeyDown` calling `requestSubmit()`. On `next dev` the
 * route's client bundle takes fifteen to thirty seconds to compile after the
 * HTML arrives, and until it does `onKeyDown` does not exist. The owner typed a
 * sentence, pressed Enter, and the browser did what a browser does with Enter
 * in a textarea: it inserted a newline. The search then went out as
 *
 *     GET /results?q=need+to+edit+PDF+free%0D%0A
 *
 * — a CRLF on the end of his sentence, in the log, in the URL, and in what the
 * reader was asked to read.
 *
 * The sentence is capped at 200 characters and has never needed a newline, so
 * the element that submits on Enter by itself is the right one. There is no
 * `onKeyDown` any more, and Enter works before hydration, after hydration, and
 * with JavaScript switched off entirely.
 *
 * The counter stays, and it is the only thing left that needs script: a count
 * that has not appeared yet is a missing courtesy, not a broken control, and
 * `maxLength` enforces the ceiling either way.
 *
 * 200 is not a stylistic choice. It is the cap the database enforces on
 * `public.search_tools` and the length `log_search_event` truncates to, so all
 * three layers agree on one number and nobody has to discover the limit by
 * being refused.
 */
export interface SearchFieldProps {
  /** Where the form submits. A GET, so a search is a URL. */
  action?: string;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  label?: string;
  /** `lg` is the homepage box; `sm` is the dock at the foot of the results. */
  size?: 'lg' | 'sm';
  autoFocus?: boolean;
  shadow?: 'violet' | 'lime' | 'coral' | 'ink';
  /** Constraints and filters that should survive the next search, as a GET. */
  hidden?: Record<string, string>;
}

const SHADOW_CLASS = {
  violet: '',
  lime: 'slab-lime',
  coral: 'slab-coral',
  ink: 'slab-ink',
} as const;

export function SearchField({
  action = '/',
  name = 'q',
  defaultValue = '',
  placeholder = 'Free way to split expenses with friends on a trip, in Spanish',
  label = 'Describe the problem you want solved',
  size = 'lg',
  autoFocus = false,
  shadow = 'violet',
  hidden,
}: SearchFieldProps) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const remaining = MAX_QUERY_LENGTH - value.length;
  const showCount = value.length >= MAX_QUERY_LENGTH - 40;

  return (
    <form
      action={action}
      method="get"
      role="search"
      className={['slab', 'searchbox', size, SHADOW_CLASS[shadow]].filter(Boolean).join(' ')}
    >
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      {hidden
        ? Object.entries(hidden).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))
        : null}

      <input
        id={id}
        name={name}
        type="text"
        // `search` would give Chrome a clear-field cross inside the slab; the
        // artboard has one control in this box and it is the send button.
        enterKeyHint="search"
        autoComplete="off"
        maxLength={MAX_QUERY_LENGTH}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        // The homepage is a single input and nothing else; landing in it is
        // what people expect. Off by default everywhere else.
        autoFocus={autoFocus}
        aria-describedby={showCount ? `${id}-count` : undefined}
      />

      {showCount ? (
        <span id={`${id}-count`} className="searchbox-count tab" aria-live="polite">
          {remaining} characters left
        </span>
      ) : null}

      <button type="submit" className="btn btn-coral btn-icon searchbox-send">
        <Icon name="arrowUp" size={26} color="var(--c-on-fill)" strokeWidth={2.25} />
        <span className="sr-only">Find tools</span>
      </button>
    </form>
  );
}
