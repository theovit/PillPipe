// Pure unit tests for AES-256-GCM token encryption: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Isolated per test via a fresh require + env override. The module lazily reads
// TOKEN_ENCRYPTION_KEY and caches it on FIRST USE (not at require time), so the env var must stay
// set until the caller has actually exercised encrypt/decrypt — restoring it any earlier means the
// module never sees the intended key at all.
function freshModule(key) {
  delete require.cache[require.resolve('../tokenCrypto')];
  process.env.TOKEN_ENCRYPTION_KEY = key;
  return require('../tokenCrypto');
}

const KEY = crypto.randomBytes(32).toString('base64url');

test('round-trips a token through encrypt/decrypt', () => {
  const { encryptToken, decryptToken } = freshModule(KEY);
  const plain = 'ya29.a0AfH6SMB...a-real-looking-google-token';
  const stored = encryptToken(plain);
  assert.notEqual(stored, plain);
  assert.equal(decryptToken(stored), plain);
});

test('encryption is non-deterministic (random IV per call)', () => {
  const { encryptToken } = freshModule(KEY);
  const a = encryptToken('same-plaintext');
  const b = encryptToken('same-plaintext');
  assert.notEqual(a, b);
});

test('null/undefined pass through unchanged', () => {
  const { encryptToken, decryptToken } = freshModule(KEY);
  assert.equal(encryptToken(null), null);
  assert.equal(encryptToken(undefined), null);
  assert.equal(decryptToken(null), null);
  assert.equal(decryptToken(undefined), null);
});

test('tampered ciphertext fails to decrypt (GCM auth tag catches it)', () => {
  const { encryptToken, decryptToken } = freshModule(KEY);
  const stored = encryptToken('secret');
  const [iv, tag, ct] = stored.split(':');
  const flipped = Buffer.from(ct, 'base64url');
  flipped[0] ^= 0xff;
  const tampered = [iv, tag, flipped.toString('base64url')].join(':');
  assert.throws(() => decryptToken(tampered));
});

test('the wrong key cannot decrypt', () => {
  const { encryptToken } = freshModule(KEY);
  const stored = encryptToken('secret');
  const { decryptToken: decryptWithOtherKey } = freshModule(crypto.randomBytes(32).toString('base64url'));
  assert.throws(() => decryptWithOtherKey(stored));
});

test('missing TOKEN_ENCRYPTION_KEY throws a clear error', () => {
  delete require.cache[require.resolve('../tokenCrypto')];
  const prev = process.env.TOKEN_ENCRYPTION_KEY;
  delete process.env.TOKEN_ENCRYPTION_KEY;
  const { encryptToken } = require('../tokenCrypto');
  assert.throws(() => encryptToken('x'), /TOKEN_ENCRYPTION_KEY is not set/);
  process.env.TOKEN_ENCRYPTION_KEY = prev;
});

test('a key of the wrong length is rejected', () => {
  delete require.cache[require.resolve('../tokenCrypto')];
  const prev = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64url');
  const { encryptToken } = require('../tokenCrypto');
  assert.throws(() => encryptToken('x'), /must decode to 32 bytes/);
  process.env.TOKEN_ENCRYPTION_KEY = prev;
});
