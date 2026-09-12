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
