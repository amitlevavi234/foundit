'use client';

import { useRef } from 'react';

/**
 * The six boxes from `EnterCode.dc.html`.
 *
 * SIX REAL FORM FIELDS, not one input with script painting boxes over it. That
 * is what makes this screen work with JavaScript switched off: the form posts
 * `d1`…`d6`, and `codeFromForm` in lib/sign-in.ts puts them back together on
 * the server. Everything this component adds — moving to the next box as you
 * type, backspacing into the previous one, and accepting a pasted code in any
 * shape a person might paste it — is an enhancement on top of a form that
 * already worked.
 *
 * `inputMode="numeric"` brings up the number pad on a phone; `autoComplete`
 * `one-time-code` is what lets iOS and Android offer the code from the
 * notification, which is the single biggest difference between this screen
 * being pleasant and being a chore.
 */
export function CodeBoxes() {
  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  function focus(index: number) {
    boxes.current[index]?.focus();
    boxes.current[index]?.select();
  }

  function spread(from: number, digits: string) {
    for (let i = 0; i < 6 - from; i += 1) {
      const box = boxes.current[from + i];
      if (box) box.value = digits[i] ?? '';
    }
    focus(Math.min(from + digits.length, 5));
  }

  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          name={`d${i + 1}`}
          className="codebox"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          autoFocus={i === 0}
          aria-label={`Digit ${i + 1} of 6`}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            const digits = event.currentTarget.value.replace(/\D/g, '');
            if (digits.length > 1) {
              // A pasted code that landed in one box.
              spread(i, digits.slice(0, 6 - i));
              return;
            }
            event.currentTarget.value = digits;
            if (digits && i < 5) focus(i + 1);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && event.currentTarget.value === '' && i > 0) {
              event.preventDefault();
              focus(i - 1);
            }
            if (event.key === 'ArrowLeft' && i > 0) focus(i - 1);
            if (event.key === 'ArrowRight' && i < 5) focus(i + 1);
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text').replace(/\D/g, '');
            if (!pasted) return;
            event.preventDefault();
            spread(i, pasted.slice(0, 6 - i));
          }}
        />
      ))}
    </div>
  );
}
