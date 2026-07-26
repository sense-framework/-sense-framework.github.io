import crypto from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';

const scryptAsync = promisify(crypto.scrypt);
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SCRYPT = Object.freeze({ N: 32_768, r: 8, p: 1, keyLength: 64, maxmem: 64 * 1024 * 1024 });

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
export const hmac256 = (secret, value) => crypto.createHmac('sha256', secret).update(String(value)).digest('base64url');

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const csrfTokenFor = (secret, sessionToken) => hmac256(secret, `csrf:${sessionToken}`);

export function parseCookies(header = '') {
  return String(header).split(';').reduce((result, entry) => {
    const separator = entry.indexOf('=');
    if (separator < 1) return result;
    const key = entry.slice(0, separator).trim();
    const rawValue = entry.slice(separator + 1).trim();
    try {
      result[key] = decodeURIComponent(rawValue);
    } catch {
      result[key] = rawValue;
    }
    return result;
  }, Object.create(null));
}

export function serializeCookie(name, value, options = {}) {
  const attributes = [`${name}=${encodeURIComponent(value)}`];
  attributes.push(`Path=${options.path || '/'}`);
  if (Number.isFinite(options.maxAge)) attributes.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.expires instanceof Date) attributes.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly !== false) attributes.push('HttpOnly');
  if (options.secure !== false) attributes.push('Secure');
  attributes.push(`SameSite=${options.sameSite || 'Strict'}`);
  return attributes.join('; ');
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT.keyLength, SCRYPT);
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    Buffer.from(derived).toString('base64url')
  ].join('$');
}

export async function verifyPassword(password, encoded) {
  const value = String(encoded || '');
  if (value.startsWith('$2')) {
    const valid = await bcrypt.compare(password, value);
    return { valid, needsUpgrade: valid };
  }
  const [kind, rawN, rawR, rawP, rawSalt, rawHash] = value.split('$');
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (
    kind !== 'scrypt' ||
    !rawSalt ||
    !rawHash ||
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N < 16_384 ||
    N > 131_072 ||
    r < 1 ||
    r > 16 ||
    p < 1 ||
    p > 4
  ) {
    return { valid: false, needsUpgrade: false };
  }
  try {
    const expected = Buffer.from(rawHash, 'base64url');
    if (expected.length < 32 || expected.length > 128) return { valid: false, needsUpgrade: false };
    const derived = await scryptAsync(password, Buffer.from(rawSalt, 'base64url'), expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT.maxmem
    });
    return {
      valid: expected.length === derived.length && crypto.timingSafeEqual(expected, derived),
      needsUpgrade: N < SCRYPT.N || r < SCRYPT.r || p < SCRYPT.p || expected.length < SCRYPT.keyLength
    };
  } catch {
    return { valid: false, needsUpgrade: false };
  }
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'qwerty', 'qwerty123', 'letmein',
  'admin', 'administrator', 'welcome', 'welcome123', 'iloveyou', 'monkey',
  'dragon', 'football', 'baseball', 'abc123', '12345678', '123456789',
  '1234567890', 'changeme'
]);

export function passwordIssues(password, identity = {}) {
  const value = String(password || '');
  const normalized = value.normalize('NFKC').toLowerCase();
  const issues = [];
  if (value.length < 15) issues.push('Use at least 15 characters');
  if (Buffer.byteLength(value, 'utf8') > 72) issues.push('Use no more than 72 UTF-8 bytes');
  if (/[\u0000-\u001f\u007f]/.test(value)) issues.push('Control characters are not allowed');
  if (COMMON_PASSWORDS.has(normalized) || COMMON_PASSWORDS.has(normalized.replace(/[^a-z0-9]/g, ''))) {
    issues.push('Choose a password that is not commonly used');
  }
  if (/^(.)\1{7,}$/u.test(value)) issues.push('Avoid repeating one character');
  const personalTokens = [
    String(identity.email || '').split('@')[0],
    identity.username,
    identity.displayName
  ].flatMap(item => String(item || '').toLowerCase().split(/[^a-z0-9]+/)).filter(item => item.length >= 4);
  if (personalTokens.some(token => normalized.includes(token))) issues.push('Do not include your name, username, or email');
  return [...new Set(issues)];
}

export function base32Encode(value) {
  const bytes = Buffer.from(value);
  let bits = 0;
  let buffer = 0;
  let output = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += BASE32[(buffer << (5 - bits)) & 31];
  return output;
}

export function base32Decode(value) {
  const clean = String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let buffer = 0;
  const output = [];
  for (const character of clean) {
    const index = BASE32.indexOf(character);
    if (index < 0) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function totpCode(secret, time = Date.now(), period = 30) {
  const counter = Math.floor(time / 1000 / period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
}

export function verifyTotp(secret, code, options = {}) {
  const supplied = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(supplied)) return false;
  const time = options.time ?? Date.now();
  const window = options.window ?? 1;
  for (let offset = -window; offset <= window; offset += 1) {
    if (safeEqual(totpCode(secret, time + offset * 30_000), supplied)) return true;
  }
  return false;
}

function encryptionKey(keyMaterial) {
  return crypto.createHash('sha256').update(String(keyMaterial)).digest();
}

export function encryptSecret(value, keyMaterial) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(keyMaterial), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(value, keyMaterial) {
  const [version, rawIv, rawTag, rawCiphertext] = String(value || '').split('.');
  if (version !== 'v1' || !rawIv || !rawTag || !rawCiphertext) throw new Error('Invalid encrypted secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(keyMaterial), Buffer.from(rawIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(rawTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(rawCiphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

export const normalizeRecoveryCode = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const recoveryCodeHash = (secret, code) => hmac256(secret, `recovery:${normalizeRecoveryCode(code)}`);

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const value = crypto.randomBytes(8).toString('hex').toUpperCase();
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`;
  });
}
