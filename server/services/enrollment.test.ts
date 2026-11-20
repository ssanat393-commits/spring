import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSignedEnrollmentToken,
  generateShortPairingCode,
  normalizePairingCode,
  verifySignedEnrollmentToken,
} from './enrollment';

test('createSignedEnrollmentToken verifies valid non-expired token', () => {
  const now = 1_700_000_000_000;
  const token = createSignedEnrollmentToken(
    {
      linkId: 'lnk-123',
      label: 'edge-laptop',
      expMs: now + 60_000,
      nonce: 'abc999',
    },
    'test-secret'
  );

  const res = verifySignedEnrollmentToken(token, 'test-secret', now + 5_000);
  assert.equal(res.valid, true);
  if (res.valid) {
    assert.equal(res.payload.linkId, 'lnk-123');
    assert.equal(res.payload.label, 'edge-laptop');
  }
});

test('verifySignedEnrollmentToken rejects tampered or expired tokens', () => {
  const now = 1_700_000_000_000;
  const token = createSignedEnrollmentToken(
    {
      linkId: 'lnk-123',
      label: 'edge-laptop',
      expMs: now + 60_000,
      nonce: 'abc999',
    },
    'test-secret'
  );

  const expired = verifySignedEnrollmentToken(token, 'test-secret', now + 120_000);
  assert.equal(expired.valid, false);

  const tampered = verifySignedEnrollmentToken(`${token}x`, 'test-secret', now + 1_000);
  assert.equal(tampered.valid, false);
});

test('generateShortPairingCode and normalizePairingCode produce and validate CIC-XXXX codes', () => {
  const code = generateShortPairingCode();
  assert.match(code, /^CIC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  assert.equal(normalizePairingCode(code.toLowerCase()), code);
  assert.equal(normalizePairingCode(code.replace('-', ' ')), code);
  assert.equal(normalizePairingCode(code.slice(4)), code);
  assert.equal(normalizePairingCode('invalid-01-code'), null);
});
