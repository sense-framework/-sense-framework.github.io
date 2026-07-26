import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const checkoutPath = '/api/v1/checkouts';

function keySecret(value = '') {
  return value.replace(/\\n/g, '\n');
}

function bearer(env, method, path) {
  const now = Math.floor(Date.now() / 1000);
  const host = new URL(env.coinbaseApiBase).host;
  return jwt.sign(
    {
      sub: env.coinbaseKeyName,
      iss: 'cdp',
      nbf: now,
      exp: now + 120,
      uri: `${method} ${host}${path}`
    },
    keySecret(env.coinbaseKeySecret),
    {
      algorithm: 'ES256',
      header: {
        kid: env.coinbaseKeyName,
        nonce: crypto.randomBytes(16).toString('hex')
      }
    }
  );
}

async function request(env, method, path, body, idempotencyKey) {
  if (!env.coinbaseEnabled) throw new Error('Cryptocurrency payments are not configured');
  const response = await fetch(`${env.coinbaseApiBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer(env, method, path)}`,
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.errorMessage || 'Cryptocurrency checkout failed');
  return result;
}

export function createCoinbaseCheckout(env, order) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return request(env, 'POST', checkoutPath, {
    amount: (order.totalCents / 100).toFixed(2),
    currency: order.currency,
    description: `SENSE order ${order.number}`,
    metadata: {
      orderId: order._id.toString(),
      customerId: order.userId.toString(),
      orderNumber: order.number
    },
    successRedirectUrl: `${env.frontendUrl}/#/orders?payment=success`,
    failRedirectUrl: `${env.frontendUrl}/#/store?payment=failed`,
    expiresAt
  }, crypto.randomUUID());
}

export function refundCoinbaseCheckout(env, checkoutId, amountCents, reason, idempotencyKey) {
  return request(
    env,
    'POST',
    `${checkoutPath}/${checkoutId}/refund`,
    { amount: (amountCents / 100).toFixed(2), currency: env.paymentCurrency, reason },
    idempotencyKey
  );
}

export function verifyCoinbaseWebhook(payload, signatureHeader, secret, headers, maxAgeMinutes = 5) {
  try {
    if (!payload || !signatureHeader || !secret) return false;
    const parts = Object.fromEntries(signatureHeader.split(',').map(item => {
      const index = item.indexOf('=');
      return [item.slice(0, index), item.slice(index + 1)];
    }));
    if (!parts.t || !parts.h || !parts.v1) return false;
    const names = parts.h.split(' ');
    const values = names.map(name => headers[String(name).toLowerCase()] || '').join('.');
    const signed = `${parts.t}.${parts.h}.${values}.${payload}`;
    const expected = crypto.createHmac('sha256', secret).update(signed, 'utf8').digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const providedBuffer = Buffer.from(parts.v1, 'hex');
    if (expectedBuffer.length !== providedBuffer.length) return false;
    if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) return false;
    const age = Math.abs(Date.now() - Number(parts.t) * 1000);
    return Number.isFinite(age) && age <= maxAgeMinutes * 60_000;
  } catch {
    return false;
  }
}
