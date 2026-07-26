import Stripe from 'stripe';

let client;

function stripe(env) {
  if (!env.stripeEnabled) throw new Error('Card payments are not configured');
  client ||= new Stripe(env.stripeSecretKey);
  return client;
}

function productData(item) {
  return {
    name: item.name,
    description: item.description || undefined,
    metadata: { productId: item.productId.toString() }
  };
}

export async function createStripeOrderCheckout(env, order, email) {
  const session = await stripe(env).checkout.sessions.create({
    mode: 'payment',
    customer_email: email,
    client_reference_id: order._id.toString(),
    line_items: order.lineItems.map(item => ({
      quantity: item.quantity,
      price_data: {
        currency: order.currency.toLowerCase(),
        unit_amount: item.unitPriceCents,
        product_data: productData(item)
      }
    })),
    metadata: { orderId: order._id.toString(), orderNumber: order.number },
    success_url: `${env.frontendUrl}/#/orders?payment=success`,
    cancel_url: `${env.frontendUrl}/#/store?payment=cancelled`,
    billing_address_collection: 'auto',
    allow_promotion_codes: true
  }, { idempotencyKey: order._id.toString() });
  return session;
}

export async function createStripeMembershipCheckout(env, order, plan, email) {
  const recurring = plan.interval === 'year' ? 'year' : 'month';
  const session = await stripe(env).checkout.sessions.create({
    mode: 'subscription',
    customer_email: email,
    client_reference_id: order._id.toString(),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: order.currency.toLowerCase(),
        unit_amount: plan.priceCents,
        recurring: { interval: recurring },
        product_data: {
          name: plan.name,
          description: plan.description || undefined,
          metadata: { planId: plan._id.toString() }
        }
      }
    }],
    metadata: {
      orderId: order._id.toString(),
      orderNumber: order.number,
      planId: plan._id.toString()
    },
    subscription_data: {
      metadata: {
        orderId: order._id.toString(),
        planId: plan._id.toString(),
        userId: order.userId.toString()
      }
    },
    success_url: `${env.frontendUrl}/#/memberships?payment=success`,
    cancel_url: `${env.frontendUrl}/#/memberships?payment=cancelled`,
    allow_promotion_codes: true
  }, { idempotencyKey: order._id.toString() });
  return session;
}

export function constructStripeEvent(env, payload, signature) {
  if (!env.stripeWebhookSecret) throw new Error('Stripe webhook secret is not configured');
  return stripe(env).webhooks.constructEvent(payload, signature, env.stripeWebhookSecret);
}

export function createStripePortal(env, customerId) {
  return stripe(env).billingPortal.sessions.create({
    customer: customerId,
    return_url: `${env.frontendUrl}/#/memberships`
  });
}

export function refundStripePayment(env, paymentIntent, amountCents, reason, idempotencyKey) {
  return stripe(env).refunds.create({
    payment_intent: paymentIntent,
    amount: amountCents,
    reason: ['duplicate', 'fraudulent', 'requested_by_customer'].includes(reason) ? reason : 'requested_by_customer'
  }, { idempotencyKey });
}
