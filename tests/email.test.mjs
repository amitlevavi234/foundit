// ===========================================================================
// The email client, and the one thing about it that must never be true in
// production: that a sign-in code can be written to a log.
//
// tests/markup.test.mjs already holds this file to the shape rules — one
// hardcoded address, one fetch, four body fields, the key only ever in a
// header. This file runs it.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMAIL_TIMEOUT_MS,
  RESEND_URL,
  devCodeLoggingAllowed,
  emailConfigured,
  sendReviewRemoved,
  sendSignInCode,
} from '../lib/email.ts';

const KEYS = ['RESEND_API_KEY', 'EMAIL_FROM', 'AUTH_DEV_CODE_TO_LOG', 'NODE_ENV'];

/** Run `fn` with the environment set to exactly `env`, then put it all back. */
async function withEnv(env, fn) {
  const saved = {};
  for (const name of KEYS) saved[name] = process.env[name];
  try {
    for (const name of KEYS) delete process.env[name];
    for (const [name, value] of Object.entries(env)) process.env[name] = value;
    return await fn();
  } finally {
    for (const name of KEYS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

/** Catch everything written to the console while `fn` runs. */
async function capturingLogs(fn) {
  const lines = [];
  const real = { warn: console.warn, error: console.error, log: console.log };
  console.warn = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    Object.assign(console, real);
  }
  return lines;
}

/** A fetch that records the request and answers however the test says. */
function fakeFetch(response = { ok: true, status: 200 }) {
  const calls = [];
  const stub = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: response.ok,
      status: response.status,
      json: async () => response.body ?? {},
    };
  };
  return { stub, calls };
}

test('configured means a key AND a sender, because half of one fails silently', async () => {
  await withEnv({}, () => assert.equal(emailConfigured(), false));
  await withEnv({ RESEND_API_KEY: 'k' }, () => assert.equal(emailConfigured(), false));
  await withEnv({ EMAIL_FROM: 'no-reply@example.com' }, () =>
    assert.equal(emailConfigured(), false),
  );
  await withEnv({ RESEND_API_KEY: '   ', EMAIL_FROM: 'no-reply@example.com' }, () =>
    assert.equal(emailConfigured(), false, 'whitespace is not a key'),
  );
  await withEnv({ RESEND_API_KEY: 'k', EMAIL_FROM: 'no-reply@example.com' }, () =>
    assert.equal(emailConfigured(), true),
  );
});

test('PRODUCTION CANNOT PRINT A CODE, whatever the environment says', async () => {
  // The load-bearing test of this file. The development log path is what makes
  // the whole flow walkable with no provider account — and it is exactly the
  // thing that must be unreachable where real people sign in.
  await withEnv({ NODE_ENV: 'production', AUTH_DEV_CODE_TO_LOG: '1' }, () => {
    assert.equal(devCodeLoggingAllowed(), false, 'both halves are required, and this is production');
  });
  await withEnv({ NODE_ENV: 'production', AUTH_DEV_CODE_TO_LOG: 'yes' }, () =>
    assert.equal(devCodeLoggingAllowed(), false),
  );
  await withEnv({ NODE_ENV: 'production' }, () => assert.equal(devCodeLoggingAllowed(), false));

  // And in development it still needs somebody to have asked for it.
  await withEnv({ NODE_ENV: 'development' }, () => assert.equal(devCodeLoggingAllowed(), false));
  await withEnv({ NODE_ENV: 'development', AUTH_DEV_CODE_TO_LOG: '0' }, () =>
    assert.equal(devCodeLoggingAllowed(), false),
  );
  await withEnv({ NODE_ENV: 'development', AUTH_DEV_CODE_TO_LOG: '1' }, () =>
    assert.equal(devCodeLoggingAllowed(), true),
  );
});

test('with no provider in production, nothing is sent and nothing is printed', async () => {
  await withEnv({ NODE_ENV: 'production', AUTH_DEV_CODE_TO_LOG: '1' }, async () => {
    const real = globalThis.fetch;
    const { calls } = fakeFetch();
    globalThis.fetch = async () => assert.fail('nothing may be sent with no provider');
    try {
      const lines = await capturingLogs(async () => {
        const result = await sendSignInCode('noa@example.com', '482915');
        assert.equal(result.delivered, false);
        assert.equal(result.reason, 'not-configured');
      });
      assert.deepEqual(lines, [], 'not one line, and certainly not the code');
      assert.deepEqual(calls, []);
    } finally {
      globalThis.fetch = real;
    }
  });
});

test('in development, with the switch on, the code is printed instead of sent', async () => {
  await withEnv({ NODE_ENV: 'development', AUTH_DEV_CODE_TO_LOG: '1' }, async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => assert.fail('the dev path must not open a socket');
    try {
      const lines = await capturingLogs(async () => {
        const result = await sendSignInCode('noa@example.com', '482915');
        assert.equal(result.delivered, true);
        assert.equal(result.reason, 'logged');
      });
      assert.equal(lines.length, 1);
      assert.match(lines[0], /482915/, 'the code is there, which is the point of the path');
      assert.match(lines[0], /development/, 'and it says loudly that this is development');
    } finally {
      globalThis.fetch = real;
    }
  });
});

test('THE SWITCH FORCES THE LOG EVEN WITH A PROVIDER CONFIGURED', async () => {
  // The Phase 6 review's F5, and the reason this test exists. The check used to
  // live inside the "there is no provider" branch, so on a development machine
  // whose .env.local holds a real RESEND_API_KEY — which is every machine that
  // has ever tested delivery once — AUTH_DEV_CODE_TO_LOG=1 did nothing at all
  // and asking for a code posted a real email to whatever address was typed.
  // The reviewer declined to exercise the code flow because of it.
  await withEnv(
    {
      NODE_ENV: 'development',
      AUTH_DEV_CODE_TO_LOG: '1',
      RESEND_API_KEY: 'k',
      EMAIL_FROM: 'no-reply@mail.example',
    },
    async () => {
      assert.equal(emailConfigured(), true, 'a provider IS configured, which is the whole point');

      const real = globalThis.fetch;
      const { stub, calls } = fakeFetch();
      globalThis.fetch = stub;
      try {
        const lines = await capturingLogs(async () => {
          const result = await sendSignInCode('noa@example.com', '482915');
          assert.equal(result.delivered, true);
          assert.equal(result.reason, 'logged', 'logged, not sent');
        });
        assert.deepEqual(calls, [], 'NOTHING may reach api.resend.com');
        assert.equal(lines.length, 1);
        assert.match(lines[0], /482915/);
        assert.match(lines[0], /nothing was sent/);
      } finally {
        globalThis.fetch = real;
      }
    },
  );

  // And it is still unreachable in production with the same provider set.
  await withEnv(
    {
      NODE_ENV: 'production',
      AUTH_DEV_CODE_TO_LOG: '1',
      RESEND_API_KEY: 'k',
      EMAIL_FROM: 'no-reply@mail.example',
    },
    async () => {
      const real = globalThis.fetch;
      const { stub, calls } = fakeFetch();
      globalThis.fetch = stub;
      try {
        const lines = await capturingLogs(async () => {
          const result = await sendSignInCode('noa@example.com', '482915');
          assert.equal(result.reason, 'sent', 'production sends, and never prints');
        });
        assert.deepEqual(lines, []);
        assert.equal(calls.length, 1);
      } finally {
        globalThis.fetch = real;
      }
    },
  );
});

test('a real send is one POST to one address, with four fields and the key in a header', async () => {
  await withEnv({ RESEND_API_KEY: 'secret-key-value', EMAIL_FROM: 'Foundit <no-reply@mail.example>' }, async () => {
    const real = globalThis.fetch;
    const { stub, calls } = fakeFetch();
    globalThis.fetch = stub;
    try {
      const lines = await capturingLogs(async () => {
        const result = await sendSignInCode('noa@example.com', '482915');
        assert.equal(result.delivered, true);
        assert.equal(result.reason, 'sent');
      });
      assert.deepEqual(lines, [], 'a successful send says nothing at all');

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, RESEND_URL, 'one address, the constant, never a variable');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.headers.authorization, 'Bearer secret-key-value');

      const body = JSON.parse(calls[0].init.body);
      assert.deepEqual(Object.keys(body).sort(), ['from', 'subject', 'text', 'to']);
      assert.equal(body.to, 'noa@example.com');
      assert.equal(body.from, 'Foundit <no-reply@mail.example>');
      assert.match(body.subject, /^482915 /, 'the code is at the START of the subject');
      assert.match(body.text, /482915/);
      // Plain and boring: no markup, no link, nothing to click.
      assert.doesNotMatch(body.text, /<[a-z]/i);
      assert.doesNotMatch(body.text, /https?:/);
      assert.equal(body.html, undefined);
    } finally {
      globalThis.fetch = real;
    }
  });
});

test('a provider failure is a reason, never the key and never the body', async () => {
  await withEnv({ RESEND_API_KEY: 'secret-key-value', EMAIL_FROM: 'no-reply@mail.example' }, async () => {
    const real = globalThis.fetch;
    const { stub } = fakeFetch({
      ok: false,
      status: 422,
      body: { message: 'The from address is not verified' },
    });
    globalThis.fetch = stub;
    try {
      const result = await sendSignInCode('noa@example.com', '482915');
      assert.equal(result.delivered, false);
      assert.match(result.reason, /^HTTP 422/);
      assert.ok(!result.reason.includes('secret-key-value'), 'the key is not in the reason');
      assert.ok(!result.reason.includes('482915'), 'nor is the code');
    } finally {
      globalThis.fetch = real;
    }
  });
});

/* ===========================================================================
 * Phase 8: the review-removal notice
 *
 * The Digital Services Act route needs the author told (research/13 §2.1,
 * docs/product-decisions.md §4), and this is the half of that which leaves the
 * machine. It is tested against a stubbed fetch exactly like the sign-in code,
 * and for the same reason: nothing in this repository may put real mail in
 * anybody's inbox.
 * ======================================================================== */

const NOTICE = {
  toolName: 'Splitwise',
  when: '12 Sep 2026',
  reason: 'names a person who did not consent to being named',
};

test('THE DEV SWITCH COVERS THE REMOVAL NOTICE TOO, not only the code', async () => {
  // The Phase 6 review's F5, applied to a message F5 predates. A development
  // machine holding a real RESEND_API_KEY — which is this one — must not put a
  // "your review was removed" mail in whatever address a throwaway test
  // account used, and the reason the switch exists is not a fact about
  // sign-in.
  await withEnv(
    {
      NODE_ENV: 'development',
      AUTH_DEV_CODE_TO_LOG: '1',
      RESEND_API_KEY: 'k',
      EMAIL_FROM: 'no-reply@mail.example',
    },
    async () => {
      assert.equal(emailConfigured(), true, 'a provider IS configured, which is the point');

      const real = globalThis.fetch;
      const { stub, calls } = fakeFetch();
      globalThis.fetch = stub;
      try {
        const lines = await capturingLogs(async () => {
          const result = await sendReviewRemoved('noa@example.com', NOTICE);
          assert.equal(result.delivered, true);
          assert.equal(result.reason, 'logged', 'logged, not sent');
        });
        assert.deepEqual(calls, [], 'NOTHING may reach api.resend.com');
        assert.equal(lines.length, 1);
        assert.match(lines[0], /nothing was sent/);
        // The log line names the listing and not the words of the review.
        assert.match(lines[0], /Splitwise/);
      } finally {
        globalThis.fetch = real;
      }
    },
  );
});

test('the notice says which review, when, why, and where to appeal', async () => {
  await withEnv(
    { RESEND_API_KEY: 'secret-key-value', EMAIL_FROM: 'Foundit <no-reply@mail.example>' },
    async () => {
      const real = globalThis.fetch;
      const { stub, calls } = fakeFetch();
      globalThis.fetch = stub;
      try {
        const result = await sendReviewRemoved('noa@example.com', NOTICE);
        assert.equal(result.delivered, true);
        assert.equal(result.reason, 'sent');

        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, RESEND_URL, 'the same one address as the code');
        assert.equal(calls[0].init.method, 'POST');
        assert.equal(calls[0].init.headers.authorization, 'Bearer secret-key-value');

        const body = JSON.parse(calls[0].init.body);
        assert.deepEqual(Object.keys(body).sort(), ['from', 'subject', 'text', 'to']);
        assert.equal(body.to, 'noa@example.com');
        assert.match(body.subject, /Splitwise/, 'the subject names the listing');
        assert.match(body.subject, /removed/);

        // The four things docs/product-decisions.md §4 promises the author.
        assert.match(body.text, /Splitwise/, 'which review');
        assert.match(body.text, /12 Sep 2026/, 'when');
        assert.match(
          body.text,
          /names a person who did not consent to being named/,
          'why, in the words an administrator wrote',
        );
        assert.match(body.text, /\/contact/, 'and where to appeal');

        // Plain and boring, exactly like the code: no markup, no link to
        // click, no HTML field, and not a copy of what they wrote.
        assert.doesNotMatch(body.text, /<[a-z]/i);
        assert.doesNotMatch(body.text, /https?:/);
        assert.equal(body.html, undefined);
        // "Removing is not editing" is the sentence the product makes, and it
        // is the one thing an author reading this needs to be told.
        assert.match(body.text, /not editing/i);
      } finally {
        globalThis.fetch = real;
      }
    },
  );
});

test('with no provider, the notice is not sent and nothing is printed', async () => {
  // The author is told twice — here, and on their own Settings page. This is
  // the path where the first one does not exist, and it must fail quietly
  // rather than pretend.
  await withEnv({ NODE_ENV: 'production' }, async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => assert.fail('nothing may be sent with no provider');
    try {
      const lines = await capturingLogs(async () => {
        const result = await sendReviewRemoved('noa@example.com', NOTICE);
        assert.equal(result.delivered, false);
        assert.equal(result.reason, 'not-configured');
      });
      assert.deepEqual(lines, []);
    } finally {
      globalThis.fetch = real;
    }
  });
});

test('a send that never comes back is abandoned rather than held', async () => {
  await withEnv({ RESEND_API_KEY: 'k', EMAIL_FROM: 'no-reply@mail.example' }, async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    try {
      const result = await sendSignInCode('noa@example.com', '482915');
      assert.equal(result.delivered, false);
      assert.match(result.reason, new RegExp(`timed out after ${EMAIL_TIMEOUT_MS} ms`));
    } finally {
      globalThis.fetch = real;
    }
  });
});
