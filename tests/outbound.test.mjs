// ===========================================================================
// The outbound link.
//
// docs/product-decisions.md §12 fixes four things about the link out to a
// maker's site, and three of them are invisible when they are wrong: a missing
// `noopener` still opens the page, a missing `noreferrer` still opens the
// page, and an `http` address still opens the page. Only a human reading the
// markup would notice, and nobody reads markup twice.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';

import { outboundLink, displayDomain } from '../lib/outbound.ts';

test('every outbound link opens in a new tab and cannot reach back', () => {
  for (const url of [
    'https://splitwise.com',
    'https://www.tricount.com/en/pricing?ref=x',
    'https://sub.domain.example.co.uk/a/b',
  ]) {
    const link = outboundLink(url);
    assert.ok(link, `${url} should be renderable`);
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
  }
});

test('the domain is shown the way a person reads it', () => {
  assert.equal(outboundLink('https://www.splitwise.com/foo').domain, 'splitwise.com');
  assert.equal(outboundLink('https://app.settleup.io').domain, 'app.settleup.io');
  assert.equal(displayDomain('https://WWW.Example.COM/'), 'example.com');
});

test('https only — everything else renders nothing at all', () => {
  for (const url of [
    'http://splitwise.com',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com',
    '//evil.example.com',
    'splitwise.com',
    '',
    null,
    undefined,
  ]) {
    assert.equal(outboundLink(url), null, `${String(url)} must not become a link`);
  }
});

test('a rejected address produces no href at all, rather than a safe-looking one', () => {
  assert.equal(outboundLink('http://example.com'), null);
});
