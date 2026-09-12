'use client';

import { useRef, type ReactNode } from 'react';

/**
 * The gate — `SaveGate.dc.html`.
 *
 * It appears at the moment somebody saves, likes or reviews without an
 * account, and never before that. docs/product-decisions.md §2 is exact about
 * this: searching, reading results and browsing never require an account, and
 * the gate is the one thing that asks.
 *
 * IT IS AN ANCHOR FIRST AND A DIALOG SECOND. The control is a real link to
 * /sign-in with `next` pointing back at the page they were on, so with
 * JavaScript switched off pressing it takes them to the sign-in screen and
 * brings them back afterwards. Where there is script, the click is
 * intercepted and the same sign-in panel opens over the page instead — which
 * is what the artboard draws, and which keeps the results behind it rather
 * than replacing them.
 *
 * A native `<dialog>` opened with `showModal()`, so the browser does the work
 * nobody should hand-roll: focus moves into it and is trapped there, Escape
 * closes it, the rest of the page goes inert, and it is announced as a dialog.
 * The only script here is `showModal`, `close`, and a click on the backdrop.
 */
export interface SignInGateProps {
  /** Where the control leads with no JavaScript: /sign-in?next=…&intent=… */
  href: string;
  /** The heading inside the sheet — "Save Splitwise to your collection". */
  title: string;
  /** One line under it, in the product's voice. */
  line: string;
  /** The trigger's contents: an icon and a word. */
  children: ReactNode;
  /** The sign-in panel, rendered on the server and passed in. */
  panel: ReactNode;
  className?: string;
}

export function SignInGate({ href, title, line, children, panel, className }: SignInGateProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <a
        href={href}
        className={className ?? 'btn btn-sm'}
        onClick={(event) => {
          // Leave every other way of following a link alone: a middle click, a
          // ctrl-click and "open in new tab" should all still go to the
          // sign-in screen.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          if (!dialog.current?.showModal) return;
          event.preventDefault();
          dialog.current.showModal();
        }}
      >
        {children}
      </a>

      <dialog
        ref={dialog}
        className="gate"
        aria-label={title}
        onClick={(event) => {
          // The backdrop is the dialog element itself; a click that lands on
          // it rather than on anything inside means "outside".
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="gate-head">
          <div>
            <h2 className="disp" style={{ fontSize: 26, margin: 0, lineHeight: 1.1 }}>
              {title}
            </h2>
            <p className="muted" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
              {line}
            </p>
          </div>
          <button
            type="button"
            className="ghost"
            aria-label="Close"
            onClick={() => dialog.current?.close()}
          >
            ✕
          </button>
        </div>

        {panel}
      </dialog>
    </>
  );
}
