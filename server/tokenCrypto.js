// AES-256-GCM at-rest encryption for the Google OAuth tokens in `google_tokens`. Same base64url
// convention as password.js (Docker Compose interpolates `$` in .env values, so no standard-base64
// padding characters anywhere they might round-trip through .env).
// Stored format: <iv b64url>:<authTag b64url>:<ciphertext b64url>
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit, the GCM-recommended IV length
const KEY_LEN = 32; // 256-bit

let cachedKey; // loaded once; env doesn't change at runtime

function loadKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set. Generate one with: ' +
      `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
    );
  }
  const key = Buffer.from(raw, 'base64url');
  if (key.length !== KEY_LEN) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must decode to ${KEY_LEN} bytes (got ${key.length}).`);
  }
  cachedKey = key;
  return cachedKey;
}

function encryptToken(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const key = loadKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map(b => b.toString('base64url')).join(':');
}

function decryptToken(stored) {
  if (stored === null || stored === undefined) return null;
  const key = loadKey();
  const parts = String(stored).split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted token (expected iv:authTag:ciphertext).');
  const [iv, authTag, ciphertext] = parts.map(p => Buffer.from(p, 'base64url'));
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { encryptToken, decryptToken };
