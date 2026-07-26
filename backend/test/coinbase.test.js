import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCoinbaseWebhook } from '../src/payments/coinbase.js';

function signature(payload, secret, headers, timestamp = Math.floor(Date.now() / 1000)) {
  const names = 'content-type x-event-id';
  const values = names.split(' ').map(name => headers[name]).join('.');
  const signed = `${timestamp}.${names}.${values}.${payload}`;
  const value = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return `t=${timestamp},h=${names},v1=${value}`;
}

test('accepts an authentic current Coinbase webhook', () => {
  const payload = JSON.stringify({ id: 'checkout', eventType: 'checkout.payment.success' });
  const secret = 'test-webhook-secret';
  const headers = { 'content-type': 'application/json', 'x-event-id': 'evt_123' };
  assert.equal(verifyCoinbaseWebhook(payload, signature(payload, secret, headers), secret, headers), true);
});

test('rejects a modified Coinbase webhook body', () => {
  const payload = JSON.stringify({ id: 'checkout', status: 'COMPLETED' });
  const secret = 'test-webhook-secret';
  const headers = { 'content-type': 'application/json', 'x-event-id': 'evt_123' };
  const header = signature(payload, secret, headers);
  assert.equal(verifyCoinbaseWebhook(`${payload}x`, header, secret, headers), false);
});

test('rejects an expired Coinbase webhook', () => {
  const payload = '{}';
  const secret = 'test-webhook-secret';
  const headers = { 'content-type': 'application/json', 'x-event-id': 'evt_123' };
  const old = Math.floor(Date.now() / 1000) - 601;
  assert.equal(verifyCoinbaseWebhook(payload, signature(payload, secret, headers, old), secret, headers), false);
});
