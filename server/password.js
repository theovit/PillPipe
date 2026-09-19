// scrypt password hashing (Node built-in — no native deps).
// Stored format is `$`-free because Docker Compose interpolates `$` in .env values:
//   scrypt:<N>:<r>:<p>:<base64url salt>:<base64url hash>
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const DEFAULTS = { N: 2 ** 15, r: 8, p: 1, saltLen: 16, keyLen: 64 };
const MIN_LENGTH = 12;

function parseHash(str) {
  const parts = String(str || '').trim().split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64url');
  const hash = Buffer.from(parts[5], 'base64url');
  if (!Number.isInteger(N) || N < 2 ** 14 || N > 2 ** 20 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 16) return null;
  if (!Number.isInteger(p) || p < 1 || p > 4) return null;
  if (salt.length < 16 || hash.length < 32) return null;
  return { N, r, p, salt, hash };
}

// Default maxmem is 32 MiB, exactly what N=2^15,r=8 needs — set it explicitly or scrypt throws.
function derive(password, { N, r, p, salt }, keyLen) {
  return scrypt(password.normalize('NFKC'), salt, keyLen, { N, r, p, maxmem: 256 * N * r * p });
}

async function hashPassword(password) {
  const params = { N: DEFAULTS.N, r: DEFAULTS.r, p: DEFAULTS.p, salt: crypto.randomBytes(DEFAULTS.saltLen) };
  const hash = await derive(password, params, DEFAULTS.keyLen);
  return ['scrypt', params.N, params.r, params.p, params.salt.toString('base64url'), hash.toString('base64url')].join(':');
}

// `parsed` is the result of parseHash(). Buffers are equal length by construction.
async function verifyPassword(password, parsed) {
  const derived = await derive(password, parsed, parsed.hash.length);
  return crypto.timingSafeEqual(derived, parsed.hash);
}

module.exports = { parseHash, hashPassword, verifyPassword, MIN_LENGTH };
