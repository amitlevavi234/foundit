'use client';

import { useId, useState, type KeyboardEvent } from 'react';

import { Icon } from './Icon';
import { MAX_QUERY_LENGTH } from '@/lib/sql';

/**
 * The one input the product has: "Say what's bugging you."
 *
 * A slab with the send button parked inside it, from the homepage artboard.
 * It is a plain `<form method="get">` with a `<textarea>`, so it works with
 * JavaScript switched off and the result is a shareable URL. The client half
 * adds two things and nothing else: Enter submits (Shift+Enter starts a new
 * line, because people write two sentences here), and a counter appears as the
 * 200-character ceiling gets close.
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
  /** The homepage box; smaller variants come later with the results screen. */
  size?: 'lg';
  autoFocus?: boolean;
  shadow?: 'violet' | 'lime' | 'coral' | 'ink';
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
}: SearchFieldProps) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const remaining = MAX_QUERY_LENGTH - value.length;
  const showCount = value.length >= MAX_QUERY_LENGTH - 40;

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

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
      <textarea
        id={id}
        name={name}
        rows={2}
        maxLength={MAX_QUERY_LENGTH}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
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
