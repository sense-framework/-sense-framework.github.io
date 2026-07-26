import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import {
  csrfTokenFor,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashPassword,
  parseCookies,
  passwordIssues,
  recoveryCodeHash,
  safeEqual,
  serializeCookie,
  totpCode,
  verifyPassword,
  verifyTotp
} from '../src/security.js';

test('scrypt password hashes verify and reject the wrong password', async () => {
  const hash = await hashPassword('Correct horse battery staple!');
  assert.match(hash, /^scrypt\$/);
  assert.deepEqual(await verifyPassword('Correct horse battery staple!', hash), { valid: true, needsUpgrade: false });
  assert.equal((await verifyPassword('wrong', hash)).valid, false);
});

test('legacy bcrypt hashes remain valid and request an upgrade', async () => {
  const hash = await bcrypt.hash('Legacy password is long!', 4);
  assert.deepEqual(await verifyPassword('Legacy password is long!', hash), { valid: true, needsUpgrade: true });
});

test('password policy rejects weak, personal, oversized, and control-character values', () => {
  assert.ok(passwordIssues('short').length);
  assert.ok(passwordIssues('alex-super-safe-but-personal', { username: 'alex' }).length);
  assert.ok(passwordIssues('a'.repeat(73)).length);
  assert.ok(passwordIssues('safe-enough-password\u0000').length);
  assert.deepEqual(passwordIssues('Correct horse battery staple!'), []);
});

test('session cookies and CSRF tokens use hardened primitives', () => {
  const cookie = serializeCookie('__Host-sense_session', 'token', { maxAge: 60, sameSite: 'None' });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=None/);
  assert.equal(parseCookies('a=1; __Host-sense_session=hello%20there')['__Host-sense_session'], 'hello there');
  assert.equal(safeEqual(csrfTokenFor('secret', 'one'), csrfTokenFor('secret', 'one')), true);
  assert.notEqual(csrfTokenFor('secret', 'one'), csrfTokenFor('secret', 'two'));
});

test('TOTP accepts the current code and rejects malformed codes', () => {
  const secret = generateTotpSecret();
  const time = 1_700_000_000_000;
  assert.equal(verifyTotp(secret, totpCode(secret, time), { time, window: 0 }), true);
  assert.equal(verifyTotp(secret, '12345', { time }), false);
  assert.equal(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000), '287082');
});

test('MFA secrets are authenticated and recovery hashes are stable', () => {
  const encrypted = encryptSecret('TOPSECRET', 'encryption-key');
  assert.equal(decryptSecret(encrypted, 'encryption-key'), 'TOPSECRET');
  assert.throws(() => decryptSecret(encrypted, 'wrong-key'));
  const parts = encrypted.split('.');
  parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;
  assert.throws(() => decryptSecret(parts.join('.'), 'encryption-key'));
  assert.equal(recoveryCodeHash('pepper', 'ABCD-EFGH'), recoveryCodeHash('pepper', 'abcdefgh'));
});
