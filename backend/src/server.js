import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { MongoClient, ObjectId } from 'mongodb';
import { z } from 'zod';
import {
  csrfTokenFor,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  hmac256,
  normalizeRecoveryCode,
  parseCookies,
  passwordIssues,
  randomToken,
  recoveryCodeHash,
  safeEqual,
  serializeCookie,
  sha256,
  verifyPassword,
  verifyTotp
} from './security.js';
import {
  createCoinbaseCheckout,
  refundCoinbaseCheckout,
  verifyCoinbaseWebhook
} from './payments/coinbase.js';
import {
  constructStripeEvent,
  createStripeMembershipCheckout,
  createStripeOrderCheckout,
  createStripePortal,
  refundStripePayment
} from './payments/stripe.js';

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8080),
  mongoUri: process.env.MONGODB_URI || '',
  dbName: process.env.MONGODB_DB || 'sense_platform',
  jwtSecret: process.env.JWT_SECRET || '',
  mfaEncryptionKey: process.env.MFA_ENCRYPTION_KEY || '',
  requireAdminMfa: String(process.env.REQUIRE_ADMIN_MFA || 'true').toLowerCase() !== 'false',
  sessionHours: Math.max(1, Math.min(Number(process.env.SESSION_HOURS || 12), 24)),
  cookieSameSite: String(process.env.COOKIE_SAME_SITE || (process.env.NODE_ENV === 'production' ? 'None' : 'Lax')),
  adminEmail: String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  ownerBootstrapToken: process.env.OWNER_BOOTSTRAP_TOKEN || '',
  requireEmailVerification: String(process.env.REQUIRE_EMAIL_VERIFICATION || (process.env.NODE_ENV === 'production' ? 'true' : 'false')).toLowerCase() !== 'false',
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: String(process.env.EMAIL_FROM || '').trim(),
  origins: String(process.env.CORS_ORIGINS || 'http://localhost:5500').split(',').map(value => value.trim()).filter(Boolean),
  frontendUrl: String(process.env.FRONTEND_URL || 'http://localhost:5500').replace(/\/$/, ''),
  trustProxy: Number(process.env.TRUST_PROXY || 1),
  paymentCurrency: String(process.env.PAYMENT_CURRENCY || 'USD').toUpperCase(),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  coinbaseKeyName: process.env.COINBASE_KEY_NAME || '',
  coinbaseKeySecret: process.env.COINBASE_KEY_SECRET || '',
  coinbaseWebhookSecret: process.env.COINBASE_WEBHOOK_SECRET || '',
  coinbaseApiBase: String(process.env.COINBASE_API_BASE || 'https://business.coinbase.com').replace(/\/$/, '')
};
env.stripeEnabled = Boolean(env.stripeSecretKey);
env.coinbaseEnabled = Boolean(env.coinbaseKeyName && env.coinbaseKeySecret);
env.emailEnabled = Boolean(env.resendApiKey && env.emailFrom);

if (!env.mongoUri) throw new Error('MONGODB_URI is required');
if (env.jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
if (env.mfaEncryptionKey.length < 32) throw new Error('MFA_ENCRYPTION_KEY must contain at least 32 characters');
if (env.nodeEnv === 'production' && safeEqual(env.jwtSecret, env.mfaEncryptionKey)) throw new Error('JWT_SECRET and MFA_ENCRYPTION_KEY must be different');
if (env.ownerBootstrapToken && [env.jwtSecret, env.mfaEncryptionKey].some(secret => safeEqual(secret, env.ownerBootstrapToken))) {
  throw new Error('OWNER_BOOTSTRAP_TOKEN must be different from application secrets');
}
if (!Number.isFinite(env.sessionHours)) throw new Error('SESSION_HOURS must be a number');
if (!['Strict', 'Lax', 'None'].includes(env.cookieSameSite)) throw new Error('COOKIE_SAME_SITE must be Strict, Lax, or None');
if (env.origins.includes('*')) throw new Error('Wildcard CORS origins are forbidden');
for (const origin of env.origins) {
  const parsed = new URL(origin);
  if (parsed.origin !== origin) throw new Error('CORS_ORIGINS entries must be exact origins without paths');
  if (env.nodeEnv === 'production' && parsed.protocol !== 'https:') throw new Error('Production CORS origins must use HTTPS');
}
const parsedFrontendUrl = new URL(env.frontendUrl);
if (env.nodeEnv === 'production' && parsedFrontendUrl.protocol !== 'https:') throw new Error('FRONTEND_URL must use HTTPS in production');
if (parsedFrontendUrl.username || parsedFrontendUrl.password || parsedFrontendUrl.search || parsedFrontendUrl.hash) {
  throw new Error('FRONTEND_URL cannot contain credentials, a query, or a fragment');
}

const client = new MongoClient(env.mongoUri, {
  maxPoolSize: 40,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 10_000,
  retryWrites: true
});
await client.connect();
const db = client.db(env.dbName);

const users = db.collection('users');
const messages = db.collection('messages');
const announcements = db.collection('announcements');
const auditEvents = db.collection('audit_events');
const products = db.collection('products');
const plans = db.collection('membership_plans');
const orders = db.collection('orders');
const memberships = db.collection('memberships');
const analytics = db.collection('analytics_events');
const settings = db.collection('settings');
const workspaceStates = db.collection('workspace_states');
const profileUpdates = db.collection('profile_updates');
const connections = db.collection('connections');
const sessions = db.collection('sessions');
const webhookEvents = db.collection('webhook_events');
const authAttempts = db.collection('auth_attempts');
const refundRequests = db.collection('refund_requests');
const authTokens = db.collection('auth_tokens');

await Promise.all([
  users.createIndex({ email: 1 }, { unique: true }),
  users.createIndex({ username: 1 }, { unique: true }),
  users.createIndex({ status: 1, displayName: 1 }),
  users.createIndex({ verificationExpiresAt: 1 }, { expireAfterSeconds: 0 }),
  messages.createIndex({ senderId: 1, recipientId: 1, createdAt: -1 }),
  messages.createIndex({ recipientId: 1, readAt: 1, createdAt: -1 }),
  messages.createIndex({ body: 'text' }),
  announcements.createIndex({ createdAt: -1 }),
  auditEvents.createIndex({ createdAt: -1 }),
  auditEvents.createIndex({ actorId: 1, createdAt: -1 }),
  products.createIndex({ slug: 1 }, { unique: true }),
  products.createIndex({ status: 1, sortOrder: 1, createdAt: -1 }),
  plans.createIndex({ slug: 1 }, { unique: true }),
  plans.createIndex({ status: 1, sortOrder: 1 }),
  orders.createIndex({ number: 1 }, { unique: true }),
  orders.createIndex({ userId: 1, createdAt: -1 }),
  orders.createIndex({ status: 1, createdAt: -1 }),
  orders.createIndex({ providerCheckoutId: 1 }, { sparse: true }),
  memberships.createIndex({ userId: 1, status: 1 }),
  memberships.createIndex({ providerSubscriptionId: 1 }, { sparse: true }),
  analytics.createIndex({ createdAt: -1 }, { expireAfterSeconds: 60 * 60 * 24 * 730 }),
  analytics.createIndex({ name: 1, createdAt: -1 }),
  workspaceStates.createIndex({ userId: 1 }, { unique: true }),
  profileUpdates.createIndex({ userId: 1, createdAt: -1 }),
  profileUpdates.createIndex({ deletedAt: 1, createdAt: -1 }),
  connections.createIndex({ pairKey: 1 }, { unique: true }),
  connections.createIndex({ requesterId: 1, status: 1, updatedAt: -1 }),
  connections.createIndex({ recipientId: 1, status: 1, updatedAt: -1 }),
  settings.createIndex({ key: 1 }, { unique: true }),
  sessions.createIndex({ tokenHash: 1 }, { unique: true }),
  sessions.createIndex({ userId: 1, createdAt: -1 }),
  sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  webhookEvents.createIndex({ provider: 1, eventId: 1 }, { unique: true }),
  webhookEvents.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  authAttempts.createIndex({ key: 1 }, { unique: true }),
  authAttempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  refundRequests.createIndex({ idempotencyKey: 1 }, { unique: true }),
  refundRequests.createIndex({ orderId: 1, createdAt: -1 }),
  authTokens.createIndex({ tokenHash: 1 }, { unique: true }),
  authTokens.createIndex({ userId: 1, type: 1 }, { unique: true }),
  authTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
]);
await users.updateMany({ role: 'user' }, { $set: { role: 'member', updatedAt: new Date() } });

const app = express();
app.set('trust proxy', env.trustProxy);
app.set('query parser', 'simple');
app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
  hsts: env.nodeEnv === 'production' ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.origins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'Stripe-Signature', 'X-Hook0-Signature'],
  exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'X-Request-ID'],
  credentials: true,
  maxAge: 86_400
}));
app.use((req, res, next) => {
  const requestId = String(req.get('x-request-id') || randomToken(12)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || randomToken(12);
  req.requestId = requestId;
  res.set({
    'X-Request-ID': requestId,
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(self)',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Cache-Control': req.path === '/health' || req.path === '/api/config' ? 'no-cache' : 'no-store'
  });
  next();
});
app.use(rateLimit({
  windowMs: 60_000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
  skip: request => request.path === '/health'
}));

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const checkoutLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 12, standardHeaders: true, legacyHeaders: false });
const messageLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
const analyticsLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
const adminLimiter = rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: true, legacyHeaders: false });

const objectId = value => ObjectId.isValid(value) ? new ObjectId(value) : null;
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const now = () => new Date();
const cleanText = (value, maximum = 500) => String(value ?? '').trim().slice(0, maximum);
const pageLimit = (value, maximum = 200) => Math.max(1, Math.min(Number(value || 50), maximum));
const orderNumber = () => `SNS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const id = value => value?._id?.toString?.() || value?.toString?.() || null;

const ROLE_PERMISSIONS = {
  owner: ['*'],
  admin: ['users', 'catalog', 'orders', 'refunds', 'memberships', 'messages', 'analytics', 'settings', 'audit', 'broadcasts'],
  support: ['orders', 'memberships', 'messages', 'users'],
  editor: ['catalog', 'settings'],
  analyst: ['analytics', 'orders', 'memberships'],
  member: []
};

const PROFILE_DEFAULTS = {
  headline: '',
  bio: '',
  location: '',
  organization: '',
  website: '',
  avatarUrl: '',
  coverUrl: '',
  availability: 'open',
  visibility: 'members',
  skills: [],
  interests: [],
  links: { facebook: '', github: '', x: '', youtube: '', website: '' },
  projects: []
};

const profileDetails = user => ({
  ...PROFILE_DEFAULTS,
  ...(user.profile || {}),
  skills: user.profile?.skills || [],
  interests: user.profile?.interests || [],
  links: { ...PROFILE_DEFAULTS.links, ...(user.profile?.links || {}) },
  projects: user.profile?.projects || []
});

const publicUser = user => ({
  id: id(user),
  displayName: user.displayName,
  username: user.username,
  role: user.role,
  status: user.status,
  mfaEnabled: Boolean(user.mfa?.enabled),
  avatarUrl: user.profile?.avatarUrl || '',
  headline: user.profile?.headline || '',
  createdAt: user.createdAt,
  lastSeenAt: user.lastSeenAt || null
});

const connectionKey = (left, right) => [id(left), id(right)].sort().join(':');
const publicConnection = (connection, viewerId) => ({
  id: id(connection),
  status: connection.status,
  direction: connection.requesterId.equals(viewerId) ? 'outgoing' : 'incoming',
  createdAt: connection.createdAt,
  updatedAt: connection.updatedAt
});

const publicProduct = product => ({
  id: id(product),
  name: product.name,
  slug: product.slug,
  description: product.description || '',
  type: product.type,
  priceCents: product.priceCents,
  currency: product.currency,
  imageUrl: product.imageUrl || '',
  tags: product.tags || [],
  featured: Boolean(product.featured),
  inventory: product.inventory?.track ? Math.max(0, (product.inventory.quantity || 0) - (product.inventory.reserved || 0)) : null,
  membershipRequired: product.membershipRequired || null
});

const publicPlan = plan => ({
  id: id(plan),
  name: plan.name,
  slug: plan.slug,
  description: plan.description || '',
  priceCents: plan.priceCents,
  currency: plan.currency,
  interval: plan.interval,
  benefits: plan.benefits || [],
  featured: Boolean(plan.featured)
});

const publicOrder = order => ({
  id: id(order),
  number: order.number,
  kind: order.kind,
  lineItems: order.lineItems,
  subtotalCents: order.subtotalCents,
  totalCents: order.totalCents,
  refundedCents: order.refundedCents || 0,
  currency: order.currency,
  status: order.status,
  fulfillmentStatus: order.fulfillmentStatus || 'unfulfilled',
  paymentProvider: order.paymentProvider,
  createdAt: order.createdAt,
  paidAt: order.paidAt || null,
  checkoutUrl: order.status === 'pending' ? order.checkoutUrl || null : null
});

const SESSION_COOKIE = env.nodeEnv === 'production' ? '__Host-sense_session' : 'sense_session';
const SESSION_SECONDS = env.sessionHours * 60 * 60;
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const dummyPasswordHash = await hashPassword('Timing defense password that is never accepted!');

function sessionCookie(token, maxAge = SESSION_SECONDS) {
  return serializeCookie(SESSION_COOKIE, token, {
    maxAge,
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: env.cookieSameSite,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', sessionCookie('', 0));
}

function requestFingerprint(req) {
  return {
    ipHash: hmac256(env.jwtSecret, `ip:${req.ip || ''}`),
    userAgentHash: hmac256(env.jwtSecret, `ua:${req.get('user-agent') || ''}`),
    device: cleanText(req.get('user-agent') || 'Unknown device', 180)
  };
}

async function issueSession(user, req, res, elevated = true) {
  const token = randomToken(32);
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + SESSION_SECONDS * 1000);
  const session = {
    tokenHash: sha256(token),
    userId: user._id,
    tokenVersion: user.tokenVersion || 0,
    ...requestFingerprint(req),
    createdAt,
    lastSeenAt: createdAt,
    expiresAt,
    elevatedUntil: elevated ? new Date(createdAt.getTime() + 10 * 60_000) : createdAt
  };
  await sessions.insertOne(session);
  const stale = await sessions.find({ userId: user._id }).sort({ createdAt: -1 }).skip(10).project({ _id: 1 }).toArray();
  if (stale.length) await sessions.deleteMany({ _id: { $in: stale.map(item => item._id) } });
  res.setHeader('Set-Cookie', sessionCookie(token));
  return { csrfToken: csrfTokenFor(env.jwtSecret, token), sessionId: id(session) };
}

function requestSessionToken(req) {
  return parseCookies(req.get('cookie') || '')[SESSION_COOKIE] || '';
}

function requireAllowedOrigin(req, res, next) {
  const origin = req.get('origin') || '';
  if (!env.origins.includes(origin)) return res.status(403).json({ error: 'Trusted origin required' });
  return next();
}

async function audit(action, actor, target = null, metadata = {}) {
  await auditEvents.insertOne({
    action,
    actorId: actor?._id || null,
    actor: actor ? { username: actor.username, role: actor.role } : null,
    targetId: target?._id || target || null,
    target: target?._id ? { username: target.username, role: target.role } : null,
    metadata,
    createdAt: now()
  });
}

async function requireAuth(req, res, next) {
  try {
    const token = requestSessionToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const session = await sessions.findOne({ tokenHash: sha256(token), expiresAt: { $gt: now() } });
    if (!session) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    const user = await users.findOne({ _id: session.userId });
    if (!user || user.status !== 'active' || (user.tokenVersion || 0) !== (session.tokenVersion || 0)) {
      await sessions.deleteOne({ _id: session._id });
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Session is no longer active' });
    }
    if (unsafeMethods.has(req.method)) {
      const origin = req.get('origin') || '';
      const suppliedCsrf = req.get('x-csrf-token') || '';
      if (!env.origins.includes(origin) || !safeEqual(suppliedCsrf, csrfTokenFor(env.jwtSecret, token))) {
        return res.status(403).json({ error: 'Request verification failed' });
      }
    }
    req.user = user;
    req.authSession = session;
    req.sessionToken = token;
    if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
      sessions.updateOne({ _id: session._id }, { $set: { lastSeenAt: now() } }).catch(() => {});
    }
    users.updateOne({ _id: user._id }, { $set: { lastSeenAt: now() } }).catch(() => {});
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

async function optionalAuth(req, _res, next) {
  const token = requestSessionToken(req);
  if (!token) return next();
  try {
    const session = await sessions.findOne({ tokenHash: sha256(token), expiresAt: { $gt: now() } });
    req.optionalUserId = session?.userId || null;
  } catch {
    req.optionalUserId = null;
  }
  return next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    const allowed = ROLE_PERMISSIONS[req.user?.role] || [];
    if (!allowed.includes('*') && !allowed.includes(permission)) {
      return res.status(403).json({ error: 'Insufficient permission' });
    }
    if (env.requireAdminMfa && ['owner', 'admin'].includes(req.user?.role) && !req.user.mfa?.enabled) {
      return res.status(403).json({ error: 'Multi-factor authentication enrollment is required for this account', code: 'MFA_ENROLLMENT_REQUIRED' });
    }
    return next();
  };
}

function requireRecentAuth(req, res, next) {
  if (!req.authSession?.elevatedUntil || req.authSession.elevatedUntil <= now()) {
    return res.status(428).json({ error: 'Confirm your password to continue', code: 'REAUTH_REQUIRED' });
  }
  return next();
}

async function revokeUserSessions(userId, exceptSessionId = null) {
  const filter = { userId };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  await sessions.deleteMany(filter);
}

const registerSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,24}$/),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(15).max(128),
  ownerSetupToken: z.string().max(256).optional()
});
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
  code: z.string().trim().max(32).optional()
});
const reauthSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().trim().max(32).optional()
});
const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const authTokenSchema = z.object({ token: z.string().min(32).max(256) });
const passwordResetSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(15).max(128)
});
const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const optionalUrl = z.string().trim().url().or(z.literal('')).refine(
  value => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  },
  'URL must use http or https and cannot contain credentials'
);
const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  headline: z.string().trim().max(120).default(''),
  bio: z.string().trim().max(1200).default(''),
  location: z.string().trim().max(100).default(''),
  organization: z.string().trim().max(120).default(''),
  website: optionalUrl.default(''),
  avatarUrl: optionalUrl.default(''),
  coverUrl: optionalUrl.default(''),
  availability: z.enum(['open', 'limited', 'unavailable']).default('open'),
  visibility: z.enum(['members', 'connections', 'private']).default('members'),
  skills: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  interests: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  links: z.object({
    facebook: optionalUrl.default(''),
    github: optionalUrl.default(''),
    x: optionalUrl.default(''),
    youtube: optionalUrl.default(''),
    website: optionalUrl.default('')
  }).default(PROFILE_DEFAULTS.links),
  projects: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(600).default(''),
    url: optionalUrl.default(''),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).default([])
  })).max(12).default([])
});
const profileUpdateSchema = z.object({ body: z.string().trim().min(1).max(1200) });
const broadcastSchema = z.object({
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(2000),
  level: z.enum(['info', 'warning', 'critical']).default('info')
});
const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  description: z.string().trim().max(4000).default(''),
  type: z.enum(['physical', 'digital', 'service']).default('digital'),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  priceCents: z.number().int().min(0).max(100_000_000),
  currency: z.string().trim().length(3).transform(value => value.toUpperCase()).default(env.paymentCurrency),
  imageUrl: optionalUrl.default(''),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
  featured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(100_000).default(100),
  inventory: z.object({ track: z.boolean().default(false), quantity: z.number().int().min(0).default(0) }).default({ track: false, quantity: 0 }),
  membershipRequired: z.string().trim().max(100).nullable().default(null)
});
const planSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  description: z.string().trim().max(4000).default(''),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  priceCents: z.number().int().min(0).max(100_000_000),
  currency: z.string().trim().length(3).transform(value => value.toUpperCase()).default(env.paymentCurrency),
  interval: z.enum(['month', 'year']).default('month'),
  benefits: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
  featured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(100_000).default(100)
});
const checkoutSchema = z.object({
  provider: z.enum(['stripe', 'coinbase']),
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().min(1).max(25) })).min(1).max(50)
});
const membershipCheckoutSchema = z.object({ provider: z.enum(['stripe', 'coinbase']), planId: z.string() });
const themeSchema = z.object({
  brandName: z.string().trim().min(1).max(60).default('SENSE'),
  theme: z.object({
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    surface: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accentStrong: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    muted: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    radius: z.number().int().min(0).max(40),
    fontScale: z.number().min(0.85).max(1.35)
  }),
  storeEnabled: z.boolean().default(true),
  membershipsEnabled: z.boolean().default(true),
  registrationEnabled: z.boolean().default(true),
  supportEmail: z.string().trim().email().or(z.literal('')).default('')
});
const DEFAULT_SETTINGS = {
  key: 'platform',
  brandName: 'SENSE',
  theme: {
    background: '#020202',
    surface: '#09090a',
    accent: '#6e000e',
    accentStrong: '#9a0018',
    text: '#f2eeee',
    muted: '#90898c',
    radius: 18,
    fontScale: 1
  },
  storeEnabled: true,
  membershipsEnabled: true,
  registrationEnabled: true,
  supportEmail: ''
};

async function platformSettings() {
  return await settings.findOne({ key: 'platform' }) || DEFAULT_SETTINGS;
}

async function recordAnalytics(name, userId, properties = {}, request = null) {
  const safeProperties = Object.fromEntries(
    Object.entries(properties || {}).slice(0, 20).map(([key, value]) => [
      cleanText(key, 60),
      typeof value === 'number' || typeof value === 'boolean' ? value : cleanText(value, 300)
    ])
  );
  await analytics.insertOne({
    name: cleanText(name, 80),
    userId: userId || null,
    properties: safeProperties,
    path: cleanText(request?.body?.path, 200),
    referrer: cleanText(request?.body?.referrer, 300),
    userAgent: cleanText(request?.get?.('user-agent'), 300),
    createdAt: now()
  });
}

function membershipPeriodEnd(plan, start = now()) {
  const end = new Date(start);
  if (plan.interval === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

async function activateMembership(order, providerData = {}) {
  if (!order.planId) return;
  const plan = await plans.findOne({ _id: order.planId });
  if (!plan) return;
  const current = now();
  const periodEnd = membershipPeriodEnd(plan, current);
  await memberships.updateOne(
    { userId: order.userId, planId: plan._id },
    {
      $set: {
        status: 'active',
        provider: order.paymentProvider,
        providerCustomerId: providerData.customer || null,
        providerSubscriptionId: providerData.subscription || null,
        currentPeriodStart: current,
        currentPeriodEnd: periodEnd,
        updatedAt: current
      },
      $setOnInsert: { userId: order.userId, planId: plan._id, createdAt: current }
    },
    { upsert: true }
  );
}

async function reserveInventory(lineItems) {
  const reserved = [];
  for (const item of lineItems) {
    const product = await products.findOne({ _id: item.productId }, { projection: { inventory: 1 } });
    if (!product?.inventory?.track) continue;
    const result = await products.updateOne(
      {
        _id: item.productId,
        status: 'active',
        'inventory.track': true,
        $expr: {
          $gte: [
            { $subtract: ['$inventory.quantity', { $ifNull: ['$inventory.reserved', 0] }] },
            item.quantity
          ]
        }
      },
      { $inc: { 'inventory.reserved': item.quantity }, $set: { updatedAt: now() } }
    );
    if (!result.modifiedCount) {
      await Promise.all(reserved.map(entry => products.updateOne(
        { _id: entry.productId },
        { $inc: { 'inventory.reserved': -entry.quantity }, $set: { updatedAt: now() } }
      )));
      return false;
    }
    reserved.push(item);
  }
  return true;
}

async function releaseInventory(order) {
  if (!order || order.kind !== 'order') return;
  const claimed = await orders.updateOne(
    { _id: order._id, inventoryState: 'reserved' },
    { $set: { inventoryState: 'released', updatedAt: now() } }
  );
  if (!claimed.modifiedCount) return;
  await Promise.all(order.lineItems.map(item => products.updateOne(
    { _id: item.productId, 'inventory.track': true },
    { $inc: { 'inventory.reserved': -item.quantity }, $set: { updatedAt: now() } }
  )));
}

async function consumeInventory(order) {
  if (!order || order.kind !== 'order') return;
  const claimed = await orders.updateOne(
    { _id: order._id, inventoryState: 'reserved' },
    { $set: { inventoryState: 'consumed', updatedAt: now() } }
  );
  if (!claimed.modifiedCount) return;
  await Promise.all(order.lineItems.map(item => products.updateOne(
    { _id: item.productId, 'inventory.track': true },
    {
      $inc: { 'inventory.quantity': -item.quantity, 'inventory.reserved': -item.quantity },
      $set: { updatedAt: now() }
    }
  )));
}

async function markOrderPaid(orderId, providerData = {}) {
  const _id = objectId(orderId);
  if (!_id) return false;
  const paidAt = now();
  const result = await orders.updateOne(
    { _id, status: { $in: ['pending', 'processing'] } },
    {
      $set: {
        status: 'paid',
        paidAt,
        updatedAt: paidAt,
        providerPaymentId: providerData.paymentIntent || providerData.transactionHash || null,
        providerCustomerId: providerData.customer || null,
        providerSubscriptionId: providerData.subscription || null
      }
    }
  );
  if (!result.modifiedCount) return false;
  const order = await orders.findOne({ _id });
  if (order.kind === 'order') {
    await consumeInventory(order);
  } else {
    await activateMembership(order, providerData);
  }
  await audit('payment.completed', null, order._id, { provider: order.paymentProvider, number: order.number });
  await recordAnalytics('purchase_completed', order.userId, {
    orderId: order._id.toString(),
    totalCents: order.totalCents,
    provider: order.paymentProvider,
    kind: order.kind
  });
  return true;
}

async function claimWebhookEvent(provider, eventId) {
  try {
    const createdAt = now();
    await webhookEvents.insertOne({
      provider,
      eventId,
      status: 'processing',
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 30 * 24 * 60 * 60_000)
    });
    return true;
  } catch (error) {
    if (error?.code === 11000) {
      const staleBefore = new Date(Date.now() - 5 * 60_000);
      const reclaimed = await webhookEvents.updateOne(
        { provider, eventId, status: 'processing', createdAt: { $lt: staleBefore } },
        { $set: { createdAt: now(), reclaimedAt: now() }, $inc: { retryCount: 1 } }
      );
      return reclaimed.modifiedCount === 1;
    }
    throw error;
  }
}

async function completeWebhookEvent(provider, eventId) {
  await webhookEvents.updateOne({ provider, eventId }, { $set: { status: 'processed', processedAt: now() } });
}

async function recordFailedLogin(user) {
  const windowMs = 15 * 60_000;
  const bucket = Math.floor(Date.now() / windowMs);
  const key = sha256(`${id(user)}:${bucket}`);
  const attempt = await authAttempts.findOneAndUpdate(
    { key },
    {
      $inc: { count: 1 },
      $setOnInsert: { userId: user._id, createdAt: now(), expiresAt: new Date((bucket + 2) * windowMs) }
    },
    { upsert: true, returnDocument: 'after' }
  );
  const failedLoginCount = attempt?.count || 1;
  const update = {
    'security.failedLoginCount': failedLoginCount,
    'security.lastFailedLoginAt': now()
  };
  if (failedLoginCount >= 10) update['security.lockedUntil'] = new Date(Date.now() + 15 * 60_000);
  await users.updateOne({ _id: user._id }, { $set: update });
  await audit('security.login_failed', null, user._id, { locked: failedLoginCount >= 10 });
}

async function verifySecondFactor(user, code) {
  if (!user.mfa?.enabled || !user.mfa.encryptedSecret) return false;
  const supplied = String(code || '').trim();
  try {
    const secret = decryptSecret(user.mfa.encryptedSecret, env.mfaEncryptionKey);
    if (verifyTotp(secret, supplied)) return true;
  } catch {
    return false;
  }
  const normalized = normalizeRecoveryCode(supplied);
  if (normalized.length !== 16) return false;
  const hash = recoveryCodeHash(env.jwtSecret, normalized);
  const matched = (user.mfa.recoveryCodeHashes || []).find(candidate => safeEqual(candidate, hash));
  if (!matched) return false;
  const consumed = await users.updateOne(
    { _id: user._id, 'mfa.recoveryCodeHashes': matched },
    { $pull: { 'mfa.recoveryCodeHashes': matched }, $set: { 'mfa.recoveryCodeUsedAt': now() } }
  );
  return consumed.modifiedCount === 1;
}

const emailEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));

function frontendTokenUrl(parameter, token) {
  const url = new URL(env.frontendUrl);
  url.hash = `/auth/${parameter}?token=${encodeURIComponent(token)}`;
  return url.toString();
}

async function sendEmail({ to, subject, text, html, idempotencyKey }) {
  if (!env.emailEnabled) throw new Error('Transactional email is not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.resendApiKey}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey
    },
    body: JSON.stringify({ from: env.emailFrom, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error('Transactional email delivery failed');
}

async function issueAuthToken(user, type, lifetimeMs) {
  const token = randomToken(32);
  const createdAt = now();
  await authTokens.deleteMany({ userId: user._id, type });
  await authTokens.insertOne({
    tokenHash: sha256(token),
    userId: user._id,
    type,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + lifetimeMs)
  });
  return token;
}

async function sendVerificationEmail(user) {
  const token = await issueAuthToken(user, 'email_verification', 24 * 60 * 60_000);
  const link = frontendTokenUrl('verify', token);
  await users.updateOne(
    { _id: user._id },
    { $set: { verificationExpiresAt: new Date(Date.now() + 24 * 60 * 60_000) } }
  );
  await sendEmail({
    to: user.email,
    subject: 'Verify your SENSE account',
    text: `Verify your SENSE account within 24 hours: ${link}`,
    html: `<p>Hello ${emailEscape(user.displayName)},</p><p>Verify your SENSE account within 24 hours.</p><p><a href="${emailEscape(link)}">Verify account</a></p><p>If you did not request this account, you can ignore this message.</p>`,
    idempotencyKey: `verify-${sha256(token).slice(0, 48)}`
  });
  await users.updateOne({ _id: user._id }, { $set: { verificationSentAt: now() } });
}

async function sendPasswordResetEmail(user) {
  const token = await issueAuthToken(user, 'password_reset', 30 * 60_000);
  const link = frontendTokenUrl('reset', token);
  await sendEmail({
    to: user.email,
    subject: 'Reset your SENSE password',
    text: `Reset your SENSE password within 30 minutes: ${link}`,
    html: `<p>Hello ${emailEscape(user.displayName)},</p><p>A password reset was requested for your SENSE account. This link expires in 30 minutes.</p><p><a href="${emailEscape(link)}">Reset password</a></p><p>If you did not request this, no action is required.</p>`,
    idempotencyKey: `reset-${sha256(token).slice(0, 48)}`
  });
  await users.updateOne({ _id: user._id }, { $set: { 'security.passwordResetSentAt': now() } });
}

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  let claimedEventId = null;
  try {
    const event = constructStripeEvent(env, req.body, req.get('stripe-signature'));
    claimedEventId = cleanText(event.id, 200);
    if (!claimedEventId || !await claimWebhookEvent('stripe', claimedEventId)) return res.json({ received: true, duplicate: true });
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await markOrderPaid(session.metadata?.orderId || session.client_reference_id, {
        paymentIntent: session.payment_intent,
        customer: session.customer,
        subscription: session.subscription
      });
    }
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const orderId = objectId(session.metadata?.orderId || session.client_reference_id);
      if (orderId) {
        const order = await orders.findOneAndUpdate(
          { _id: orderId, status: { $in: ['pending', 'processing'] } },
          { $set: { status: 'expired', updatedAt: now() } },
          { returnDocument: 'after' }
        );
        await releaseInventory(order);
      }
    }
    if (event.type.startsWith('customer.subscription.')) {
      const subscription = event.data.object;
      const status = ['active', 'trialing'].includes(subscription.status) ? 'active' : subscription.status === 'canceled' ? 'cancelled' : 'past_due';
      await memberships.updateOne(
        { providerSubscriptionId: subscription.id },
        {
          $set: {
            status,
            currentPeriodStart: subscription.current_period_start ? new Date(subscription.current_period_start * 1000) : undefined,
            currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : undefined,
            updatedAt: now()
          }
        }
      );
    }
    await completeWebhookEvent('stripe', claimedEventId);
    res.json({ received: true });
  } catch {
    if (claimedEventId) await webhookEvents.deleteOne({ provider: 'stripe', eventId: claimedEventId }).catch(() => {});
    res.status(400).json({ error: 'Invalid webhook' });
  }
});

app.post('/api/webhooks/coinbase', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const payload = req.body.toString('utf8');
  const valid = verifyCoinbaseWebhook(payload, req.get('x-hook0-signature'), env.coinbaseWebhookSecret, req.headers);
  if (!valid) return res.status(400).json({ error: 'Invalid webhook' });
  let claimedEventId = null;
  try {
    const event = JSON.parse(payload);
    claimedEventId = cleanText(event.id || event.eventId || event.data?.id || hmac256(env.jwtSecret, payload), 200);
    if (!await claimWebhookEvent('coinbase', claimedEventId)) return res.json({ received: true, duplicate: true });
    const orderId = event.metadata?.orderId;
    if (event.eventType === 'checkout.payment.success') {
      await markOrderPaid(orderId, { transactionHash: event.transactionHash });
    } else if (orderId && ['checkout.payment.failed', 'checkout.payment.expired'].includes(event.eventType)) {
      const order = await orders.findOneAndUpdate(
        { _id: objectId(orderId), status: { $in: ['pending', 'processing'] } },
        { $set: { status: event.eventType.endsWith('expired') ? 'expired' : 'failed', updatedAt: now() } },
        { returnDocument: 'after' }
      );
      await releaseInventory(order);
    } else if (orderId && event.eventType === 'checkout.refund.success') {
      await orders.updateOne(
        { _id: objectId(orderId) },
        { $set: { status: 'refunded', refundedCents: Math.round(Number(event.refundedAmount || event.amount || 0) * 100), updatedAt: now() } }
      );
    }
    await completeWebhookEvent('coinbase', claimedEventId);
    return res.json({ received: true });
  } catch {
    if (claimedEventId) await webhookEvents.deleteOne({ provider: 'coinbase', eventId: claimedEventId }).catch(() => {});
    return res.status(400).json({ error: 'Invalid event' });
  }
});

app.use(express.json({ limit: '768kb' }));
app.use('/api/admin', adminLimiter);

app.get('/health', async (_req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({
      ok: true,
      service: 'sense-platform-api',
      version: '1.2.0',
      payments: { card: env.stripeEnabled, crypto: env.coinbaseEnabled },
      time: now().toISOString()
    });
  } catch {
    res.status(503).json({ ok: false, error: 'Database unavailable' });
  }
});

app.get('/api/config', async (_req, res) => {
  const value = await platformSettings();
  res.json({
    brandName: value.brandName,
    theme: value.theme,
    features: {
      store: value.storeEnabled,
      memberships: value.membershipsEnabled,
      registration: value.registrationEnabled
    },
    payments: { card: env.stripeEnabled, crypto: env.coinbaseEnabled },
    supportEmail: value.supportEmail || ''
  });
});

app.post('/api/auth/register', authLimiter, requireAllowedOrigin, async (req, res) => {
  const value = await platformSettings();
  if (!value.registrationEnabled) return res.status(403).json({ error: 'Registration is currently closed' });
  if (env.requireEmailVerification && !env.emailEnabled) {
    return res.status(503).json({ error: 'Account email delivery is not configured' });
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Use a valid email and a password of at least 15 characters' });
  const { displayName, username, email, password, ownerSetupToken } = parsed.data;
  const issues = passwordIssues(password, { displayName, username, email });
  if (issues.length) return res.status(400).json({ error: issues[0], issues });
  const ownerRegistration = Boolean(env.adminEmail && email === env.adminEmail);
  if (ownerRegistration && (env.ownerBootstrapToken.length < 32 || !safeEqual(ownerSetupToken || '', env.ownerBootstrapToken))) {
    await audit('security.owner_bootstrap_rejected', null, null, { requestId: req.requestId });
    return res.status(403).json({ error: 'Owner setup key is required for this account' });
  }
  const duplicate = await users.findOne({ $or: [{ email }, { username }] }, { projection: { _id: 1 } });
  if (duplicate) return res.status(409).json({ error: 'Email or username is already registered' });
  const createdAt = now();
  const user = {
    displayName,
    username,
    email,
    passwordHash: await hashPassword(password),
    role: env.requireEmailVerification ? 'member' : ownerRegistration ? 'owner' : 'member',
    ...(env.requireEmailVerification ? { pendingRole: ownerRegistration ? 'owner' : 'member' } : {}),
    status: env.requireEmailVerification ? 'pending_verification' : 'active',
    tokenVersion: 0,
    createdAt,
    updatedAt: createdAt,
    lastSeenAt: createdAt
  };
  const result = await users.insertOne(user);
  user._id = result.insertedId;
  await audit('user.registered', user, user);
  await recordAnalytics('account_created', user._id);
  if (env.requireEmailVerification) {
    try {
      await sendVerificationEmail(user);
    } catch (error) {
      console.error('Verification email failed', { requestId: req.requestId, userId: id(user), error: error?.message });
      return res.status(503).json({ error: 'Account created, but verification email could not be sent. Use resend verification.' });
    }
    return res.status(202).json({ verificationRequired: true });
  }
  const session = await issueSession(user, req, res);
  return res.status(201).json({ ...session, user: publicUser(user) });
});

app.post('/api/auth/verify-email', authLimiter, requireAllowedOrigin, async (req, res) => {
  const parsed = authTokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Verification link is invalid or expired' });
  const tokenHash = sha256(parsed.data.token);
  const token = await authTokens.findOne({ tokenHash, type: 'email_verification', expiresAt: { $gt: now() } });
  if (!token) return res.status(400).json({ error: 'Verification link is invalid or expired' });
  const consumed = await authTokens.findOneAndDelete({ _id: token._id, tokenHash, expiresAt: { $gt: now() } });
  if (!consumed) return res.status(400).json({ error: 'Verification link is invalid or expired' });
  const user = await users.findOneAndUpdate(
    { _id: token.userId, status: 'pending_verification' },
    {
      $set: { status: 'active', role: 'member', updatedAt: now(), emailVerifiedAt: now() },
      $unset: { verificationExpiresAt: '', verificationSentAt: '' }
    },
    { returnDocument: 'after' }
  );
  if (!user) return res.status(400).json({ error: 'Verification link is invalid or expired' });
  if (user.pendingRole === 'owner') {
    await users.updateOne({ _id: user._id }, { $set: { role: 'owner' }, $unset: { pendingRole: '' } });
    user.role = 'owner';
    delete user.pendingRole;
  } else {
    await users.updateOne({ _id: user._id }, { $unset: { pendingRole: '' } });
  }
  await audit('security.email_verified', user, user);
  const session = await issueSession(user, req, res);
  return res.json({ ...session, user: publicUser(user) });
});

app.post('/api/auth/resend-verification', authLimiter, requireAllowedOrigin, async (req, res) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) return res.json({ accepted: true });
  const user = await users.findOne({ email: parsed.data.email, status: 'pending_verification' });
  const recentlySent = user?.verificationSentAt && Date.now() - user.verificationSentAt.getTime() < 5 * 60_000;
  if (user && env.emailEnabled && !recentlySent) {
    try {
      await sendVerificationEmail(user);
      await audit('security.verification_resent', user, user);
    } catch (error) {
      console.error('Verification resend failed', { requestId: req.requestId, userId: id(user), error: error?.message });
    }
  }
  return res.json({ accepted: true });
});

app.post('/api/auth/password-reset/request', authLimiter, requireAllowedOrigin, async (req, res) => {
  const parsed = emailSchema.safeParse(req.body);
  if (parsed.success) {
    const user = await users.findOne({ email: parsed.data.email, status: 'active' });
    const recentlySent = user?.security?.passwordResetSentAt && Date.now() - user.security.passwordResetSentAt.getTime() < 5 * 60_000;
    if (user && env.emailEnabled && !recentlySent) {
      try {
        await sendPasswordResetEmail(user);
        await audit('security.password_reset_requested', user, user);
      } catch (error) {
        console.error('Password reset email failed', { requestId: req.requestId, userId: id(user), error: error?.message });
      }
    }
  }
  return res.json({ accepted: true });
});

app.post('/api/auth/password-reset/confirm', authLimiter, requireAllowedOrigin, async (req, res) => {
  const parsed = passwordResetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Reset link or password is invalid' });
  const tokenHash = sha256(parsed.data.token);
  const token = await authTokens.findOne({ tokenHash, type: 'password_reset', expiresAt: { $gt: now() } });
  const user = token ? await users.findOne({ _id: token.userId }) : null;
  if (!token || !user) return res.status(400).json({ error: 'Reset link is invalid or expired' });
  const issues = passwordIssues(parsed.data.password, user);
  if (issues.length) return res.status(400).json({ error: issues[0], issues });
  const consumed = await authTokens.findOneAndDelete({ _id: token._id, tokenHash, expiresAt: { $gt: now() } });
  if (!consumed) return res.status(400).json({ error: 'Reset link is invalid or expired' });
  const passwordHash = await hashPassword(parsed.data.password);
  await users.updateOne(
    { _id: user._id },
    {
      $set: { passwordHash, passwordChangedAt: now(), updatedAt: now(), 'security.failedLoginCount': 0 },
      $unset: { 'security.lockedUntil': '', 'security.lastFailedLoginAt': '', 'security.passwordResetSentAt': '' },
      $inc: { tokenVersion: 1 }
    }
  );
  await Promise.all([
    revokeUserSessions(user._id),
    authAttempts.deleteMany({ userId: user._id }),
    authTokens.deleteMany({ userId: user._id })
  ]);
  await audit('security.password_reset_completed', user, user);
  return res.json({ reset: true });
});

app.post('/api/auth/login', authLimiter, requireAllowedOrigin, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Email and password are required' });
  const user = await users.findOne({ email: parsed.data.email });
  const verification = await verifyPassword(parsed.data.password, user?.passwordHash || dummyPasswordHash);
  if (!user || !verification.valid) {
    if (user) await recordFailedLogin(user);
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }
  if (user.security?.lockedUntil && user.security.lockedUntil > now()) {
    return res.status(429).json({ error: 'Sign-in is temporarily unavailable. Try again later.' });
  }
  if (user.status === 'pending_verification') return res.status(403).json({ error: 'Verify your email before signing in' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Account is not active' });
  if (user.mfa?.enabled) {
    if (!parsed.data.code) return res.status(202).json({ mfaRequired: true });
    if (!await verifySecondFactor(user, parsed.data.code)) {
      await recordFailedLogin(user);
      return res.status(401).json({ error: 'Email, password, or verification code is incorrect' });
    }
  }
  const passwordHash = verification.needsUpgrade ? await hashPassword(parsed.data.password) : user.passwordHash;
  await users.updateOne(
    { _id: user._id },
    {
      $set: { lastSeenAt: now(), passwordHash, 'security.failedLoginCount': 0 },
      $unset: { 'security.lockedUntil': '', 'security.lastFailedLoginAt': '' }
    }
  );
  await authAttempts.deleteMany({ userId: user._id });
  user.passwordHash = passwordHash;
  await audit('user.login', user, user);
  await recordAnalytics('login', user._id);
  const session = await issueSession(user, req, res);
  return res.json({ ...session, user: publicUser(user) });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const activeMemberships = await memberships.find({ userId: req.user._id, status: 'active' }).toArray();
  const planIds = activeMemberships.map(item => item.planId);
  const relatedPlans = planIds.length ? await plans.find({ _id: { $in: planIds } }).toArray() : [];
  const planMap = new Map(relatedPlans.map(plan => [plan._id.toString(), plan]));
  res.json({
    user: publicUser(req.user),
    csrfToken: csrfTokenFor(env.jwtSecret, req.sessionToken),
    memberships: activeMemberships.map(item => ({
      id: id(item),
      status: item.status,
      provider: item.provider,
      currentPeriodEnd: item.currentPeriodEnd,
      plan: planMap.get(item.planId.toString()) ? publicPlan(planMap.get(item.planId.toString())) : null
    }))
  });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await sessions.deleteOne({ _id: req.authSession._id });
  await audit('user.logout', req.user, req.user);
  clearSessionCookie(res);
  res.status(204).end();
});

app.post('/api/auth/reauth', authLimiter, requireAuth, async (req, res) => {
  const parsed = reauthSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Password is required' });
  const verification = await verifyPassword(parsed.data.password, req.user.passwordHash);
  if (!verification.valid || req.user.mfa?.enabled && !await verifySecondFactor(req.user, parsed.data.code)) {
    await audit('security.reauthentication_failed', req.user, req.user, { requestId: req.requestId });
    return res.status(401).json({ error: 'Password or verification code is incorrect' });
  }
  const elevatedUntil = new Date(Date.now() + 10 * 60_000);
  await sessions.updateOne({ _id: req.authSession._id }, { $set: { elevatedUntil } });
  await audit('security.reauthenticated', req.user, req.user);
  res.json({ elevatedUntil });
});

app.get('/api/auth/sessions', requireAuth, async (req, res) => {
  const result = await sessions.find({ userId: req.user._id, expiresAt: { $gt: now() } }).sort({ lastSeenAt: -1 }).toArray();
  res.json({
    sessions: result.map(item => ({
      id: id(item),
      current: item._id.equals(req.authSession._id),
      device: item.device,
      createdAt: item.createdAt,
      lastSeenAt: item.lastSeenAt,
      expiresAt: item.expiresAt
    }))
  });
});

app.delete('/api/auth/sessions/:sessionId', requireAuth, async (req, res) => {
  const sessionId = objectId(req.params.sessionId);
  if (!sessionId) return res.status(400).json({ error: 'Invalid session' });
  const result = await sessions.deleteOne({ _id: sessionId, userId: req.user._id });
  if (!result.deletedCount) return res.status(404).json({ error: 'Session not found' });
  const current = sessionId.equals(req.authSession._id);
  await audit('security.session_revoked', req.user, sessionId, { current });
  if (current) clearSessionCookie(res);
  res.status(204).end();
});

app.post('/api/auth/sessions/revoke-others', requireAuth, requireRecentAuth, async (req, res) => {
  await revokeUserSessions(req.user._id, req.authSession._id);
  await audit('security.other_sessions_revoked', req.user, req.user);
  res.status(204).end();
});

app.post('/api/auth/mfa/setup', requireAuth, requireRecentAuth, async (req, res) => {
  const secret = generateTotpSecret();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await sessions.updateOne(
    { _id: req.authSession._id },
    { $set: { pendingMfa: { encryptedSecret: encryptSecret(secret, env.mfaEncryptionKey), expiresAt } } }
  );
  const issuer = encodeURIComponent('SENSE');
  const account = encodeURIComponent(req.user.email);
  res.json({
    secret,
    expiresAt,
    otpauthUri: `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
  });
});

app.post('/api/auth/mfa/enable', requireAuth, requireRecentAuth, async (req, res) => {
  const parsed = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).safeParse(req.body);
  const pending = (await sessions.findOne({ _id: req.authSession._id }))?.pendingMfa;
  if (!parsed.success || !pending || pending.expiresAt <= now()) return res.status(400).json({ error: 'Start MFA setup again' });
  const secret = decryptSecret(pending.encryptedSecret, env.mfaEncryptionKey);
  if (!verifyTotp(secret, parsed.data.code)) return res.status(400).json({ error: 'Verification code is incorrect' });
  const recoveryCodes = generateRecoveryCodes();
  await users.updateOne(
    { _id: req.user._id },
    {
      $set: {
        mfa: {
          enabled: true,
          encryptedSecret: encryptSecret(secret, env.mfaEncryptionKey),
          recoveryCodeHashes: recoveryCodes.map(code => recoveryCodeHash(env.jwtSecret, code)),
          enabledAt: now()
        },
        updatedAt: now()
      }
    }
  );
  await sessions.updateOne({ _id: req.authSession._id }, { $unset: { pendingMfa: '' } });
  await revokeUserSessions(req.user._id, req.authSession._id);
  await audit('security.mfa_enabled', req.user, req.user);
  res.json({ enabled: true, recoveryCodes });
});

app.post('/api/auth/mfa/disable', authLimiter, requireAuth, async (req, res) => {
  const parsed = z.object({
    password: z.string().min(1).max(128),
    code: z.string().trim().min(6).max(32)
  }).safeParse(req.body);
  const password = parsed.success ? await verifyPassword(parsed.data.password, req.user.passwordHash) : { valid: false };
  if (!req.user.mfa?.enabled || !parsed.success || !password.valid || !await verifySecondFactor(req.user, parsed.data.code)) {
    return res.status(400).json({ error: 'Password or verification code is incorrect' });
  }
  await users.updateOne({ _id: req.user._id }, { $unset: { mfa: '' }, $set: { updatedAt: now() } });
  await revokeUserSessions(req.user._id, req.authSession._id);
  await audit('security.mfa_disabled', req.user, req.user);
  res.json({ enabled: false });
});

app.get('/api/store/products', async (req, res) => {
  const query = cleanText(req.query.q, 80);
  const filter = { status: 'active' };
  if (query) filter.$or = [
    { name: { $regex: escapeRegex(query), $options: 'i' } },
    { tags: { $regex: escapeRegex(query), $options: 'i' } }
  ];
  const result = await products.find(filter).sort({ featured: -1, sortOrder: 1, createdAt: -1 }).limit(200).toArray();
  res.json({ products: result.map(publicProduct) });
});

app.get('/api/store/plans', async (_req, res) => {
  const result = await plans.find({ status: 'active' }).sort({ featured: -1, sortOrder: 1, priceCents: 1 }).toArray();
  res.json({ plans: result.map(publicPlan) });
});

app.get('/api/orders', requireAuth, async (req, res) => {
  const result = await orders.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100).toArray();
  res.json({ orders: result.map(publicOrder) });
});

app.post('/api/checkout/order', requireAuth, checkoutLimiter, async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Checkout request is invalid' });
  if (parsed.data.provider === 'stripe' && !env.stripeEnabled) return res.status(503).json({ error: 'Card payments are not configured' });
  if (parsed.data.provider === 'coinbase' && !env.coinbaseEnabled) return res.status(503).json({ error: 'Cryptocurrency payments are not configured' });
  const grouped = new Map();
  for (const item of parsed.data.items) grouped.set(item.productId, (grouped.get(item.productId) || 0) + item.quantity);
  const ids = [...grouped.keys()].map(objectId);
  if (ids.some(value => !value)) return res.status(400).json({ error: 'Cart contains an invalid product' });
  const found = await products.find({ _id: { $in: ids }, status: 'active' }).toArray();
  if (found.length !== ids.length) return res.status(409).json({ error: 'A cart item is no longer available' });
  if (found.some(product => product.currency !== env.paymentCurrency)) return res.status(409).json({ error: 'Cart currency is not supported' });
  const unavailable = found.find(product => {
    if (!product.inventory?.track) return false;
    const available = (product.inventory.quantity || 0) - (product.inventory.reserved || 0);
    return grouped.get(product._id.toString()) > available;
  });
  if (unavailable) return res.status(409).json({ error: `${unavailable.name} does not have enough inventory` });
  const lineItems = found.map(product => {
    const quantity = grouped.get(product._id.toString());
    return {
      productId: product._id,
      name: product.name,
      description: product.description || '',
      type: product.type,
      unitPriceCents: product.priceCents,
      quantity,
      totalCents: product.priceCents * quantity
    };
  });
  const subtotalCents = lineItems.reduce((sum, item) => sum + item.totalCents, 0);
  if (subtotalCents < 50) return res.status(400).json({ error: 'Order total must be at least $0.50' });
  const createdAt = now();
  const order = {
    _id: new ObjectId(),
    number: orderNumber(),
    kind: 'order',
    userId: req.user._id,
    lineItems,
    subtotalCents,
    totalCents: subtotalCents,
    refundedCents: 0,
    currency: env.paymentCurrency,
    status: 'pending',
    fulfillmentStatus: 'unfulfilled',
    inventoryState: 'unreserved',
    paymentProvider: parsed.data.provider,
    createdAt,
    updatedAt: createdAt
  };
  await orders.insertOne(order);
  const reserved = await reserveInventory(lineItems);
  if (!reserved) {
    await orders.updateOne(
      { _id: order._id },
      { $set: { status: 'failed', failureReason: 'Inventory changed during checkout', updatedAt: now() } }
    );
    return res.status(409).json({ error: 'Inventory changed while checkout was being prepared. Review the cart and try again.' });
  }
  order.inventoryState = 'reserved';
  await orders.updateOne({ _id: order._id }, { $set: { inventoryState: 'reserved', updatedAt: now() } });
  try {
    const checkout = parsed.data.provider === 'stripe'
      ? await createStripeOrderCheckout(env, order, req.user.email)
      : await createCoinbaseCheckout(env, order);
    order.providerCheckoutId = checkout.id;
    order.checkoutUrl = checkout.url;
    await orders.updateOne({ _id: order._id }, { $set: { providerCheckoutId: checkout.id, checkoutUrl: checkout.url, updatedAt: now() } });
    await audit('checkout.created', req.user, order._id, { provider: parsed.data.provider, number: order.number });
    await recordAnalytics('checkout_started', req.user._id, { provider: parsed.data.provider, totalCents: order.totalCents, kind: 'order' });
    return res.status(201).json({ order: publicOrder(order), checkoutUrl: checkout.url });
  } catch (error) {
    await orders.updateOne({ _id: order._id }, { $set: { status: 'failed', failureReason: 'Payment provider unavailable', updatedAt: now() } });
    await releaseInventory(await orders.findOne({ _id: order._id }));
    console.error('Order checkout failed', { requestId: req.requestId, orderId: id(order), provider: parsed.data.provider, error: error?.message });
    return res.status(502).json({ error: 'Checkout could not be created' });
  }
});

app.post('/api/checkout/membership', requireAuth, checkoutLimiter, async (req, res) => {
  const parsed = membershipCheckoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Membership checkout is invalid' });
  if (parsed.data.provider === 'stripe' && !env.stripeEnabled) return res.status(503).json({ error: 'Card payments are not configured' });
  if (parsed.data.provider === 'coinbase' && !env.coinbaseEnabled) return res.status(503).json({ error: 'Cryptocurrency payments are not configured' });
  const planId = objectId(parsed.data.planId);
  const plan = planId && await plans.findOne({ _id: planId, status: 'active' });
  if (!plan) return res.status(404).json({ error: 'Membership plan not found' });
  const createdAt = now();
  const order = {
    _id: new ObjectId(),
    number: orderNumber(),
    kind: 'membership',
    userId: req.user._id,
    planId: plan._id,
    lineItems: [{ planId: plan._id, name: plan.name, unitPriceCents: plan.priceCents, quantity: 1, totalCents: plan.priceCents }],
    subtotalCents: plan.priceCents,
    totalCents: plan.priceCents,
    refundedCents: 0,
    currency: plan.currency,
    status: 'pending',
    paymentProvider: parsed.data.provider,
    createdAt,
    updatedAt: createdAt
  };
  await orders.insertOne(order);
  try {
    const checkout = parsed.data.provider === 'stripe'
      ? await createStripeMembershipCheckout(env, order, plan, req.user.email)
      : await createCoinbaseCheckout(env, order);
    order.providerCheckoutId = checkout.id;
    order.checkoutUrl = checkout.url;
    await orders.updateOne({ _id: order._id }, { $set: { providerCheckoutId: checkout.id, checkoutUrl: checkout.url, updatedAt: now() } });
    await audit('membership.checkout_created', req.user, order._id, { provider: parsed.data.provider, planId: plan._id.toString() });
    await recordAnalytics('checkout_started', req.user._id, { provider: parsed.data.provider, totalCents: order.totalCents, kind: 'membership' });
    return res.status(201).json({ order: publicOrder(order), checkoutUrl: checkout.url });
  } catch (error) {
    await orders.updateOne({ _id: order._id }, { $set: { status: 'failed', failureReason: 'Payment provider unavailable', updatedAt: now() } });
    console.error('Membership checkout failed', { requestId: req.requestId, orderId: id(order), provider: parsed.data.provider, error: error?.message });
    return res.status(502).json({ error: 'Checkout could not be created' });
  }
});

app.post('/api/billing/portal', requireAuth, async (req, res) => {
  const membership = await memberships.findOne({
    userId: req.user._id,
    provider: 'stripe',
    providerCustomerId: { $type: 'string' },
    status: { $in: ['active', 'past_due'] }
  });
  if (!membership) return res.status(404).json({ error: 'No card-managed membership found' });
  const session = await createStripePortal(env, membership.providerCustomerId);
  res.json({ url: session.url });
});

app.get('/api/users', requireAuth, async (req, res) => {
  const query = cleanText(req.query.q, 60);
  const filter = { _id: { $ne: req.user._id }, status: 'active' };
  if (query) filter.$or = [
    { displayName: { $regex: escapeRegex(query), $options: 'i' } },
    { username: { $regex: escapeRegex(query), $options: 'i' } }
  ];
  const result = await users.find(filter, { projection: { passwordHash: 0, email: 0, tokenVersion: 0 } }).sort({ displayName: 1 }).limit(50).toArray();
  res.json({ users: result.map(publicUser) });
});

app.get('/api/profiles/:username', requireAuth, async (req, res) => {
  const username = cleanText(req.params.username, 24).toLowerCase();
  const target = await users.findOne({ username, status: 'active' });
  if (!target) return res.status(404).json({ error: 'Profile not found' });
  const own = target._id.equals(req.user._id);
  const elevated = ['owner', 'admin', 'support'].includes(req.user.role);
  const relationship = own ? null : await connections.findOne({ pairKey: connectionKey(req.user._id, target._id) });
  const details = profileDetails(target);
  if (!own && !elevated && details.visibility === 'private') {
    return res.status(403).json({ error: 'This profile is private' });
  }
  if (!own && !elevated && details.visibility === 'connections' && relationship?.status !== 'accepted') {
    return res.status(403).json({ error: 'This profile is visible to connections' });
  }
  const [connectionCount, updateCount, updates] = await Promise.all([
    connections.countDocuments({
      status: 'accepted',
      $or: [{ requesterId: target._id }, { recipientId: target._id }]
    }),
    profileUpdates.countDocuments({ userId: target._id, deletedAt: null }),
    profileUpdates.find({ userId: target._id, deletedAt: null }).sort({ createdAt: -1 }).limit(40).toArray()
  ]);
  res.json({
    user: publicUser(target),
    profile: details,
    own,
    connection: relationship ? publicConnection(relationship, req.user._id) : null,
    stats: {
      connections: connectionCount,
      updates: updateCount,
      projects: details.projects.length
    },
    updates: updates.map(item => ({ id: id(item), body: item.body, createdAt: item.createdAt }))
  });
});

app.put('/api/profile', requireAuth, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Profile details are invalid',
      issues: parsed.error.issues.map(issue => issue.path.join('.'))
    });
  }
  const { displayName, ...profile } = parsed.data;
  const updatedAt = now();
  await users.updateOne(
    { _id: req.user._id },
    { $set: { displayName, profile, updatedAt } }
  );
  const updated = await users.findOne({ _id: req.user._id });
  await audit('profile.updated', updated, updated, { fields: Object.keys(profile) });
  res.json({ user: publicUser(updated), profile: profileDetails(updated) });
});

app.post('/api/profile/updates', requireAuth, messageLimiter, async (req, res) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Update must contain between 1 and 1,200 characters' });
  const update = {
    userId: req.user._id,
    body: parsed.data.body,
    createdAt: now(),
    deletedAt: null
  };
  const result = await profileUpdates.insertOne(update);
  await recordAnalytics('profile_update_created', req.user._id);
  res.status(201).json({ update: { id: result.insertedId.toString(), body: update.body, createdAt: update.createdAt } });
});

app.delete('/api/profile/updates/:updateId', requireAuth, async (req, res) => {
  const updateId = objectId(req.params.updateId);
  if (!updateId) return res.status(400).json({ error: 'Invalid profile update' });
  const result = await profileUpdates.updateOne(
    { _id: updateId, userId: req.user._id, deletedAt: null },
    { $set: { deletedAt: now() } }
  );
  if (!result.modifiedCount) return res.status(404).json({ error: 'Profile update not found' });
  res.status(204).end();
});

app.get('/api/connections', requireAuth, async (req, res) => {
  const rows = await connections.find({
    $or: [{ requesterId: req.user._id }, { recipientId: req.user._id }]
  }).sort({ updatedAt: -1 }).limit(500).toArray();
  const peerIds = rows.map(item => item.requesterId.equals(req.user._id) ? item.recipientId : item.requesterId);
  const peers = peerIds.length ? await users.find({ _id: { $in: peerIds }, status: 'active' }).toArray() : [];
  const peerMap = new Map(peers.map(user => [user._id.toString(), user]));
  res.json({
    connections: rows.map(item => {
      const peerId = item.requesterId.equals(req.user._id) ? item.recipientId : item.requesterId;
      const peer = peerMap.get(peerId.toString());
      return peer ? { ...publicConnection(item, req.user._id), user: publicUser(peer) } : null;
    }).filter(Boolean)
  });
});

app.post('/api/connections/:userId', requireAuth, async (req, res) => {
  const targetId = objectId(req.params.userId);
  if (!targetId || targetId.equals(req.user._id)) return res.status(400).json({ error: 'Connection target is invalid' });
  const target = await users.findOne({ _id: targetId, status: 'active' });
  if (!target) return res.status(404).json({ error: 'User not found' });
  const pairKey = connectionKey(req.user._id, targetId);
  let connection = await connections.findOne({ pairKey });
  if (!connection) {
    const createdAt = now();
    const created = {
      pairKey,
      requesterId: req.user._id,
      recipientId: targetId,
      status: 'pending',
      createdAt,
      updatedAt: createdAt
    };
    try {
      const result = await connections.insertOne(created);
      connection = { ...created, _id: result.insertedId };
      await recordAnalytics('connection_requested', req.user._id, { targetId: targetId.toString() });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      connection = await connections.findOne({ pairKey });
    }
  }
  if (connection.status === 'pending' && connection.recipientId.equals(req.user._id)) {
    const updatedAt = now();
    await connections.updateOne({ _id: connection._id }, { $set: { status: 'accepted', updatedAt } });
    connection = { ...connection, status: 'accepted', updatedAt };
    await recordAnalytics('connection_accepted', req.user._id, { targetId: targetId.toString() });
  }
  res.json({ connection: publicConnection(connection, req.user._id) });
});

app.delete('/api/connections/:userId', requireAuth, async (req, res) => {
  const targetId = objectId(req.params.userId);
  if (!targetId || targetId.equals(req.user._id)) return res.status(400).json({ error: 'Connection target is invalid' });
  await connections.deleteOne({ pairKey: connectionKey(req.user._id, targetId) });
  res.status(204).end();
});

app.get('/api/announcements', requireAuth, async (_req, res) => {
  const result = await announcements.find({ active: true }).sort({ createdAt: -1 }).limit(30).toArray();
  res.json({
    announcements: result.map(item => ({
      id: id(item),
      title: item.title,
      body: item.body,
      level: item.level,
      createdAt: item.createdAt
    }))
  });
});

app.get('/api/conversations', requireAuth, async (req, res) => {
  const mine = req.user._id;
  const rows = await messages.find({
    $or: [{ senderId: mine }, { recipientId: mine }],
    deletedAt: null
  }).sort({ createdAt: -1 }).limit(2500).toArray();
  const byPeer = new Map();
  for (const row of rows) {
    const peerId = row.senderId.equals(mine) ? row.recipientId : row.senderId;
    const key = peerId.toString();
    const current = byPeer.get(key) || { peerId, lastMessage: row, unreadCount: 0 };
    if (row.recipientId.equals(mine) && !row.readAt) current.unreadCount += 1;
    byPeer.set(key, current);
  }
  const peerIds = [...byPeer.values()].map(value => value.peerId);
  const peers = peerIds.length ? await users.find({ _id: { $in: peerIds } }).toArray() : [];
  const peerMap = new Map(peers.map(user => [user._id.toString(), user]));
  const conversations = [...byPeer.values()].map(item => ({
    user: peerMap.has(item.peerId.toString()) ? publicUser(peerMap.get(item.peerId.toString())) : null,
    unreadCount: item.unreadCount,
    lastMessage: {
      id: id(item.lastMessage),
      body: item.lastMessage.moderation?.hidden ? '[removed]' : item.lastMessage.body,
      createdAt: item.lastMessage.createdAt
    }
  })).filter(item => item.user).sort((a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt));
  res.json({ conversations });
});

app.get('/api/conversations/:userId/messages', requireAuth, async (req, res) => {
  const peerId = objectId(req.params.userId);
  if (!peerId) return res.status(400).json({ error: 'Invalid user' });
  const peer = await users.findOne({ _id: peerId, status: 'active' });
  if (!peer) return res.status(404).json({ error: 'User not found' });
  const filter = {
    $or: [{ senderId: req.user._id, recipientId: peerId }, { senderId: peerId, recipientId: req.user._id }],
    deletedAt: null
  };
  const result = await messages.find(filter).sort({ createdAt: 1 }).limit(1000).toArray();
  await messages.updateMany({ senderId: peerId, recipientId: req.user._id, readAt: null }, { $set: { readAt: now() } });
  res.json({
    messages: result.map(item => ({
      id: id(item),
      senderId: item.senderId.toString(),
      recipientId: item.recipientId.toString(),
      body: item.moderation?.hidden ? '[removed by moderation]' : item.body,
      createdAt: item.createdAt,
      readAt: item.readAt
    }))
  });
});

app.post('/api/conversations/:userId/messages', requireAuth, messageLimiter, async (req, res) => {
  const peerId = objectId(req.params.userId);
  const parsed = messageSchema.safeParse(req.body);
  if (!peerId || !parsed.success) return res.status(400).json({ error: 'Message is invalid' });
  if (peerId.equals(req.user._id)) return res.status(400).json({ error: 'Cannot message this account' });
  const peer = await users.findOne({ _id: peerId, status: 'active' });
  if (!peer) return res.status(404).json({ error: 'User not found' });
  const message = {
    senderId: req.user._id,
    recipientId: peerId,
    body: parsed.data.body,
    createdAt: now(),
    readAt: null,
    deletedAt: null,
    moderation: { hidden: false }
  };
  const result = await messages.insertOne(message);
  await recordAnalytics('message_sent', req.user._id);
  res.status(201).json({
    message: {
      id: result.insertedId.toString(),
      ...message,
      senderId: message.senderId.toString(),
      recipientId: message.recipientId.toString()
    }
  });
});

app.get('/api/workspace', requireAuth, async (req, res) => {
  const record = await workspaceStates.findOne({ userId: req.user._id });
  res.json({ workspace: record?.workspace || null, enterprise: record?.enterprise || null, updatedAt: record?.updatedAt || null });
});

app.put('/api/workspace', requireAuth, async (req, res) => {
  const workspace = req.body?.workspace;
  const enterprise = req.body?.enterprise;
  if ((workspace != null && (typeof workspace !== 'object' || Array.isArray(workspace))) ||
      (enterprise != null && (typeof enterprise !== 'object' || Array.isArray(enterprise)))) {
    return res.status(400).json({ error: 'Workspace data is invalid' });
  }
  const serialized = JSON.stringify({ workspace, enterprise });
  if (Buffer.byteLength(serialized) > 650_000) return res.status(413).json({ error: 'Workspace data is too large' });
  await workspaceStates.updateOne(
    { userId: req.user._id },
    { $set: { userId: req.user._id, workspace: workspace || {}, enterprise: enterprise || {}, updatedAt: now() } },
    { upsert: true }
  );
  res.json({ saved: true, updatedAt: now() });
});

app.post('/api/analytics/events', analyticsLimiter, optionalAuth, async (req, res) => {
  const name = cleanText(req.body?.name, 80);
  if (!/^[a-z0-9_.-]{2,80}$/i.test(name)) return res.status(400).json({ error: 'Event name is invalid' });
  await recordAnalytics(name, req.optionalUserId, req.body?.properties, req);
  res.status(202).json({ accepted: true });
});

app.get('/api/admin/summary', requireAuth, requirePermission('analytics'), async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [
    userCount,
    activeMemberCount,
    productCount,
    pendingOrders,
    messageCount,
    revenueRows,
    recentEvents
  ] = await Promise.all([
    users.countDocuments(),
    memberships.countDocuments({ status: 'active' }),
    products.countDocuments({ status: 'active' }),
    orders.countDocuments({ status: 'pending' }),
    messages.countDocuments({ createdAt: { $gte: since }, deletedAt: null }),
    orders.aggregate([
      { $match: { status: { $in: ['paid', 'fulfilled', 'partially_refunded'] }, paidAt: { $gte: since } } },
      { $group: { _id: null, amount: { $sum: { $subtract: ['$totalCents', { $ifNull: ['$refundedCents', 0] }] } }, count: { $sum: 1 } } }
    ]).toArray(),
    auditEvents.find({}).sort({ createdAt: -1 }).limit(12).toArray()
  ]);
  res.json({
    metrics: {
      users: userCount,
      activeMembers: activeMemberCount,
      activeProducts: productCount,
      pendingOrders,
      messages30d: messageCount,
      revenue30dCents: revenueRows[0]?.amount || 0,
      paidOrders30d: revenueRows[0]?.count || 0
    },
    recentEvents: recentEvents.map(event => ({
      id: id(event),
      action: event.action,
      actor: event.actor,
      metadata: event.metadata,
      createdAt: event.createdAt
    }))
  });
});

app.get('/api/admin/users', requireAuth, requirePermission('users'), async (req, res) => {
  const query = cleanText(req.query.q, 80);
  const filter = {};
  if (query) filter.$or = [
    { displayName: { $regex: escapeRegex(query), $options: 'i' } },
    { username: { $regex: escapeRegex(query), $options: 'i' } },
    { email: { $regex: escapeRegex(query), $options: 'i' } }
  ];
  const result = await users.find(filter, { projection: { passwordHash: 0, tokenVersion: 0 } }).sort({ createdAt: -1 }).limit(pageLimit(req.query.limit, 500)).toArray();
  res.json({ users: result.map(user => ({ ...publicUser(user), email: user.email })) });
});

app.patch('/api/admin/users/:userId', requireAuth, requirePermission('users'), requireRecentAuth, async (req, res) => {
  const userId = objectId(req.params.userId);
  const schema = z.object({
    role: z.enum(['owner', 'admin', 'support', 'editor', 'analyst', 'member']).optional(),
    status: z.enum(['active', 'suspended']).optional()
  }).refine(value => value.role || value.status, 'No changes supplied');
  const parsed = schema.safeParse(req.body);
  if (!userId || !parsed.success) return res.status(400).json({ error: 'Account update is invalid' });
  const target = await users.findOne({ _id: userId });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target._id.equals(req.user._id) && (parsed.data.status === 'suspended' || parsed.data.role && parsed.data.role !== req.user.role)) {
    return res.status(400).json({ error: 'You cannot lock or demote your own account' });
  }
  if (target.status === 'pending_verification') {
    return res.status(409).json({ error: 'Pending accounts must verify their email before administrative changes' });
  }
  if (parsed.data.role && req.user.role !== 'owner') return res.status(403).json({ error: 'Only an owner can change account roles' });
  if (['owner', 'admin'].includes(target.role) && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Only an owner can change a privileged account' });
  }
  const update = { ...parsed.data, updatedAt: now(), tokenVersion: (target.tokenVersion || 0) + 1 };
  await users.updateOne({ _id: userId }, { $set: update });
  await revokeUserSessions(userId);
  const updated = await users.findOne({ _id: userId });
  await audit('admin.user_updated', req.user, updated, parsed.data);
  res.json({ user: { ...publicUser(updated), email: updated.email } });
});

app.get('/api/admin/products', requireAuth, requirePermission('catalog'), async (_req, res) => {
  const result = await products.find({}).sort({ sortOrder: 1, createdAt: -1 }).toArray();
  res.json({ products: result.map(item => ({ ...publicProduct(item), status: item.status, inventory: item.inventory, sortOrder: item.sortOrder })) });
});

app.post('/api/admin/products', requireAuth, requirePermission('catalog'), async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Product details are invalid', issues: parsed.error.issues.map(issue => issue.path.join('.')) });
  const createdAt = now();
  const product = {
    ...parsed.data,
    inventory: { ...parsed.data.inventory, reserved: 0 },
    createdAt,
    updatedAt: createdAt,
    createdBy: req.user._id
  };
  const result = await products.insertOne(product);
  product._id = result.insertedId;
  await audit('catalog.product_created', req.user, product._id, { name: product.name, status: product.status });
  res.status(201).json({ product: { ...publicProduct(product), status: product.status, inventory: product.inventory, sortOrder: product.sortOrder } });
});

app.put('/api/admin/products/:productId', requireAuth, requirePermission('catalog'), async (req, res) => {
  const productId = objectId(req.params.productId);
  const parsed = productSchema.safeParse(req.body);
  if (!productId || !parsed.success) return res.status(400).json({ error: 'Product details are invalid' });
  const { inventory, ...productData } = parsed.data;
  const result = await products.findOneAndUpdate(
    { _id: productId },
    {
      $set: {
        ...productData,
        'inventory.track': inventory.track,
        'inventory.quantity': inventory.quantity,
        updatedAt: now(),
        updatedBy: req.user._id
      }
    },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Product not found' });
  await audit('catalog.product_updated', req.user, result._id, { name: result.name, status: result.status });
  res.json({ product: { ...publicProduct(result), status: result.status, inventory: result.inventory, sortOrder: result.sortOrder } });
});

app.delete('/api/admin/products/:productId', requireAuth, requirePermission('catalog'), requireRecentAuth, async (req, res) => {
  const productId = objectId(req.params.productId);
  if (!productId) return res.status(400).json({ error: 'Invalid product' });
  const result = await products.findOneAndUpdate(
    { _id: productId },
    { $set: { status: 'archived', updatedAt: now(), updatedBy: req.user._id } },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Product not found' });
  await audit('catalog.product_archived', req.user, result._id, { name: result.name });
  res.status(204).end();
});

app.get('/api/admin/plans', requireAuth, requirePermission('catalog'), async (_req, res) => {
  const result = await plans.find({}).sort({ sortOrder: 1, priceCents: 1 }).toArray();
  res.json({ plans: result.map(item => ({ ...publicPlan(item), status: item.status, sortOrder: item.sortOrder })) });
});

app.post('/api/admin/plans', requireAuth, requirePermission('catalog'), async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Membership plan is invalid' });
  const createdAt = now();
  const plan = { ...parsed.data, createdAt, updatedAt: createdAt, createdBy: req.user._id };
  const result = await plans.insertOne(plan);
  plan._id = result.insertedId;
  await audit('membership.plan_created', req.user, plan._id, { name: plan.name });
  res.status(201).json({ plan: { ...publicPlan(plan), status: plan.status, sortOrder: plan.sortOrder } });
});

app.put('/api/admin/plans/:planId', requireAuth, requirePermission('catalog'), async (req, res) => {
  const planId = objectId(req.params.planId);
  const parsed = planSchema.safeParse(req.body);
  if (!planId || !parsed.success) return res.status(400).json({ error: 'Membership plan is invalid' });
  const result = await plans.findOneAndUpdate(
    { _id: planId },
    { $set: { ...parsed.data, updatedAt: now(), updatedBy: req.user._id } },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Membership plan not found' });
  await audit('membership.plan_updated', req.user, result._id, { name: result.name });
  res.json({ plan: { ...publicPlan(result), status: result.status, sortOrder: result.sortOrder } });
});

app.delete('/api/admin/plans/:planId', requireAuth, requirePermission('catalog'), requireRecentAuth, async (req, res) => {
  const planId = objectId(req.params.planId);
  if (!planId) return res.status(400).json({ error: 'Invalid membership plan' });
  const result = await plans.findOneAndUpdate(
    { _id: planId },
    { $set: { status: 'archived', updatedAt: now(), updatedBy: req.user._id } },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Membership plan not found' });
  await audit('membership.plan_archived', req.user, result._id, { name: result.name });
  res.status(204).end();
});

app.get('/api/admin/orders', requireAuth, requirePermission('orders'), async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = cleanText(req.query.status, 30);
  const result = await orders.find(filter).sort({ createdAt: -1 }).limit(pageLimit(req.query.limit, 500)).toArray();
  const userIds = [...new Set(result.map(item => item.userId.toString()))].map(value => new ObjectId(value));
  const relatedUsers = userIds.length ? await users.find({ _id: { $in: userIds } }, { projection: { displayName: 1, email: 1 } }).toArray() : [];
  const userMap = new Map(relatedUsers.map(user => [user._id.toString(), user]));
  res.json({
    orders: result.map(order => ({
      ...publicOrder(order),
      customer: userMap.has(order.userId.toString()) ? {
        id: order.userId.toString(),
        displayName: userMap.get(order.userId.toString()).displayName,
        email: userMap.get(order.userId.toString()).email
      } : null
    }))
  });
});

app.patch('/api/admin/orders/:orderId', requireAuth, requirePermission('orders'), async (req, res) => {
  const orderId = objectId(req.params.orderId);
  const parsed = z.object({
    fulfillmentStatus: z.enum(['unfulfilled', 'processing', 'fulfilled', 'cancelled']),
    note: z.string().trim().max(500).optional()
  }).safeParse(req.body);
  if (!orderId || !parsed.success) return res.status(400).json({ error: 'Order update is invalid' });
  const result = await orders.findOneAndUpdate(
    { _id: orderId },
    {
      $set: { fulfillmentStatus: parsed.data.fulfillmentStatus, updatedAt: now() },
      ...(parsed.data.note ? { $push: { notes: { body: parsed.data.note, actorId: req.user._id, createdAt: now() } } } : {})
    },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Order not found' });
  await audit('order.updated', req.user, result._id, { fulfillmentStatus: parsed.data.fulfillmentStatus });
  res.json({ order: publicOrder(result) });
});

app.post('/api/admin/orders/:orderId/refund', requireAuth, requirePermission('refunds'), requireRecentAuth, checkoutLimiter, async (req, res) => {
  const orderId = objectId(req.params.orderId);
  const idempotencyKey = cleanText(req.get('idempotency-key'), 128);
  const parsed = z.object({
    amountCents: z.number().int().min(1),
    reason: z.string().trim().min(3).max(300)
  }).safeParse(req.body);
  if (!orderId || !parsed.success || !/^[A-Za-z0-9_.:-]{16,128}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: 'Refund request is invalid' });
  }
  try {
    await refundRequests.insertOne({
      idempotencyKey,
      orderId,
      actorId: req.user._id,
      amountCents: parsed.data.amountCents,
      reason: parsed.data.reason,
      status: 'processing',
      createdAt: now()
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await refundRequests.findOne({ idempotencyKey, orderId, actorId: req.user._id });
    if (existing?.status === 'completed') {
      return res.status(202).json({ status: existing.orderStatus, refundedCents: existing.refundedCents, duplicate: true });
    }
    if (existing?.status !== 'failed') {
      return res.status(409).json({ error: 'This refund request is already being processed' });
    }
    const retry = await refundRequests.updateOne(
      { _id: existing._id, status: 'failed' },
      { $set: { status: 'processing', retriedAt: now() }, $inc: { retryCount: 1 } }
    );
    if (!retry.modifiedCount) return res.status(409).json({ error: 'This refund request is already being processed' });
  }

  const lockExpiresAt = new Date(Date.now() + 2 * 60_000);
  const order = await orders.findOneAndUpdate(
    {
      _id: orderId,
      status: { $in: ['paid', 'fulfilled', 'partially_refunded'] },
      $or: [{ refundLock: { $exists: false } }, { 'refundLock.expiresAt': { $lt: now() } }]
    },
    { $set: { refundLock: { idempotencyKey, expiresAt: lockExpiresAt }, updatedAt: now() } },
    { returnDocument: 'after' }
  );
  if (!order) {
    await refundRequests.updateOne({ idempotencyKey }, { $set: { status: 'rejected', completedAt: now() } });
    return res.status(409).json({ error: 'Order is not refundable or another refund is in progress' });
  }

  try {
    const remaining = order.totalCents - (order.refundedCents || 0);
    if (parsed.data.amountCents > remaining) {
      await orders.updateOne({ _id: order._id, 'refundLock.idempotencyKey': idempotencyKey }, { $unset: { refundLock: '' } });
      await refundRequests.updateOne({ idempotencyKey }, { $set: { status: 'rejected', completedAt: now() } });
      return res.status(400).json({ error: 'Refund exceeds the remaining paid amount' });
    }
    if (order.paymentProvider === 'stripe') {
      if (!order.providerPaymentId) throw new Error('Missing payment reference');
      await refundStripePayment(env, order.providerPaymentId, parsed.data.amountCents, parsed.data.reason, idempotencyKey);
    } else {
      if (!order.providerCheckoutId) throw new Error('Missing checkout reference');
      await refundCoinbaseCheckout(env, order.providerCheckoutId, parsed.data.amountCents, parsed.data.reason, idempotencyKey);
    }
    const refundedCents = (order.refundedCents || 0) + parsed.data.amountCents;
    const status = refundedCents >= order.totalCents ? 'refunded' : 'partially_refunded';
    await orders.updateOne(
      { _id: order._id, 'refundLock.idempotencyKey': idempotencyKey },
      { $set: { refundedCents, status, updatedAt: now() }, $unset: { refundLock: '' } }
    );
    await refundRequests.updateOne(
      { idempotencyKey },
      { $set: { status: 'completed', orderStatus: status, refundedCents, completedAt: now() } }
    );
    await audit('order.refund_created', req.user, order._id, {
      amountCents: parsed.data.amountCents,
      provider: order.paymentProvider,
      idempotencyKey
    });
    return res.status(202).json({ status, refundedCents });
  } catch (error) {
    await Promise.all([
      orders.updateOne({ _id: order._id, 'refundLock.idempotencyKey': idempotencyKey }, { $unset: { refundLock: '' } }),
      refundRequests.updateOne({ idempotencyKey }, { $set: { status: 'failed', completedAt: now() } })
    ]);
    await audit('order.refund_failed', req.user, order._id, { provider: order.paymentProvider, idempotencyKey });
    console.error('Refund failed', { requestId: req.requestId, orderId: id(order), error: error?.message });
    return res.status(502).json({ error: 'Payment provider could not complete the refund' });
  }
});

app.get('/api/admin/memberships', requireAuth, requirePermission('memberships'), async (req, res) => {
  const result = await memberships.find({}).sort({ createdAt: -1 }).limit(pageLimit(req.query.limit, 500)).toArray();
  const userIds = [...new Set(result.map(item => item.userId.toString()))].map(value => new ObjectId(value));
  const planIds = [...new Set(result.map(item => item.planId.toString()))].map(value => new ObjectId(value));
  const [relatedUsers, relatedPlans] = await Promise.all([
    userIds.length ? users.find({ _id: { $in: userIds } }, { projection: { displayName: 1, email: 1 } }).toArray() : [],
    planIds.length ? plans.find({ _id: { $in: planIds } }).toArray() : []
  ]);
  const userMap = new Map(relatedUsers.map(user => [user._id.toString(), user]));
  const planMap = new Map(relatedPlans.map(plan => [plan._id.toString(), plan]));
  res.json({
    memberships: result.map(item => ({
      id: id(item),
      status: item.status,
      provider: item.provider,
      currentPeriodStart: item.currentPeriodStart,
      currentPeriodEnd: item.currentPeriodEnd,
      customer: userMap.get(item.userId.toString()) || null,
      plan: planMap.has(item.planId.toString()) ? publicPlan(planMap.get(item.planId.toString())) : null
    }))
  });
});

app.patch('/api/admin/memberships/:membershipId', requireAuth, requirePermission('memberships'), requireRecentAuth, async (req, res) => {
  const membershipId = objectId(req.params.membershipId);
  const parsed = z.object({
    status: z.enum(['active', 'past_due', 'paused', 'cancelled']),
    currentPeriodEnd: z.string().datetime().optional()
  }).safeParse(req.body);
  if (!membershipId || !parsed.success) return res.status(400).json({ error: 'Membership update is invalid' });
  const result = await memberships.findOneAndUpdate(
    { _id: membershipId },
    { $set: { status: parsed.data.status, ...(parsed.data.currentPeriodEnd ? { currentPeriodEnd: new Date(parsed.data.currentPeriodEnd) } : {}), updatedAt: now() } },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Membership not found' });
  await audit('membership.updated', req.user, result._id, { status: result.status });
  res.json({ membership: { id: id(result), status: result.status, currentPeriodEnd: result.currentPeriodEnd } });
});

app.get('/api/admin/messages', requireAuth, requirePermission('messages'), async (req, res) => {
  const query = cleanText(req.query.q, 100);
  const filter = { deletedAt: null };
  if (query) filter.$text = { $search: query };
  const result = await messages.find(filter).sort({ createdAt: -1 }).limit(pageLimit(req.query.limit, 500)).toArray();
  const participantIds = [...new Set(result.flatMap(item => [item.senderId.toString(), item.recipientId.toString()]))].map(value => new ObjectId(value));
  const relatedUsers = participantIds.length ? await users.find({ _id: { $in: participantIds } }, { projection: { displayName: 1, username: 1 } }).toArray() : [];
  const userMap = new Map(relatedUsers.map(user => [user._id.toString(), user]));
  res.json({
    messages: result.map(item => ({
      id: id(item),
      body: item.body,
      hidden: Boolean(item.moderation?.hidden),
      moderationReason: item.moderation?.reason || '',
      createdAt: item.createdAt,
      sender: userMap.get(item.senderId.toString()) || null,
      recipient: userMap.get(item.recipientId.toString()) || null
    }))
  });
});

app.patch('/api/admin/messages/:messageId', requireAuth, requirePermission('messages'), async (req, res) => {
  const messageId = objectId(req.params.messageId);
  const parsed = z.object({ hidden: z.boolean(), reason: z.string().trim().max(300).default('') }).safeParse(req.body);
  if (!messageId || !parsed.success) return res.status(400).json({ error: 'Moderation update is invalid' });
  const result = await messages.findOneAndUpdate(
    { _id: messageId, deletedAt: null },
    { $set: { moderation: { hidden: parsed.data.hidden, reason: parsed.data.reason, actorId: req.user._id, updatedAt: now() } } },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Message not found' });
  await audit('message.moderated', req.user, result._id, { hidden: parsed.data.hidden, reason: parsed.data.reason });
  res.json({ message: { id: id(result), hidden: Boolean(result.moderation?.hidden) } });
});

app.delete('/api/admin/messages/:messageId', requireAuth, requirePermission('messages'), requireRecentAuth, async (req, res) => {
  const messageId = objectId(req.params.messageId);
  if (!messageId) return res.status(400).json({ error: 'Invalid message' });
  const result = await messages.findOneAndUpdate(
    { _id: messageId, deletedAt: null },
    { $set: { deletedAt: now(), deletedBy: req.user._id } },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Message not found' });
  await audit('message.deleted', req.user, result._id);
  res.status(204).end();
});

app.get('/api/admin/analytics', requireAuth, requirePermission('analytics'), async (req, res) => {
  const days = Math.max(1, Math.min(Number(req.query.days || 30), 365));
  const since = new Date(Date.now() - days * 86_400_000);
  const [events, revenue, chats, signups] = await Promise.all([
    analytics.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$name', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 30 }
    ]).toArray(),
    orders.aggregate([
      { $match: { paidAt: { $gte: since }, status: { $in: ['paid', 'fulfilled', 'partially_refunded'] } } },
      {
        $group: {
          _id: { $dateToString: { date: '$paidAt', format: '%Y-%m-%d' } },
          amountCents: { $sum: { $subtract: ['$totalCents', { $ifNull: ['$refundedCents', 0] }] } },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray(),
    messages.aggregate([
      { $match: { createdAt: { $gte: since }, deletedAt: null } },
      { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray(),
    users.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray()
  ]);
  res.json({
    rangeDays: days,
    events: events.map(item => ({ name: item._id, count: item.count })),
    revenue: revenue.map(item => ({ date: item._id, amountCents: item.amountCents, orders: item.orders })),
    chats: chats.map(item => ({ date: item._id, count: item.count })),
    signups: signups.map(item => ({ date: item._id, count: item.count }))
  });
});

app.get('/api/admin/settings', requireAuth, requirePermission('settings'), async (_req, res) => {
  const value = await platformSettings();
  res.json({ settings: value });
});

app.put('/api/admin/settings', requireAuth, requirePermission('settings'), requireRecentAuth, async (req, res) => {
  const parsed = themeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Platform settings are invalid' });
  const value = { key: 'platform', ...parsed.data, updatedAt: now(), updatedBy: req.user._id };
  await settings.updateOne({ key: 'platform' }, { $set: value }, { upsert: true });
  await audit('settings.updated', req.user, null, { fields: Object.keys(parsed.data) });
  res.json({ settings: value });
});

app.get('/api/admin/payments', requireAuth, requirePermission('settings'), async (_req, res) => {
  res.json({
    providers: {
      stripe: {
        enabled: env.stripeEnabled,
        webhookConfigured: Boolean(env.stripeWebhookSecret),
        capabilities: ['cards', 'wallets', 'subscriptions', 'customer portal', 'refunds']
      },
      coinbase: {
        enabled: env.coinbaseEnabled,
        webhookConfigured: Boolean(env.coinbaseWebhookSecret),
        capabilities: ['USDC checkout', 'crypto settlement', 'x402', 'refunds']
      }
    },
    currency: env.paymentCurrency,
    webhookPaths: {
      stripe: '/api/webhooks/stripe',
      coinbase: '/api/webhooks/coinbase'
    }
  });
});

app.post('/api/admin/broadcasts', requireAuth, requirePermission('broadcasts'), requireRecentAuth, async (req, res) => {
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Broadcast is invalid' });
  const announcement = {
    ...parsed.data,
    active: true,
    createdBy: req.user._id,
    createdAt: now(),
    updatedAt: now()
  };
  const result = await announcements.insertOne(announcement);
  await audit('admin.broadcast_created', req.user, result.insertedId, { level: announcement.level });
  res.status(201).json({ announcement: { id: result.insertedId.toString(), ...parsed.data, createdAt: announcement.createdAt } });
});

app.get('/api/admin/audit', requireAuth, requirePermission('audit'), async (req, res) => {
  const result = await auditEvents.find({}).sort({ createdAt: -1 }).limit(pageLimit(req.query.limit, 500)).toArray();
  res.json({
    events: result.map(item => ({
      id: id(item),
      action: item.action,
      actor: item.actor,
      target: item.target,
      metadata: item.metadata,
      createdAt: item.createdAt
    }))
  });
});

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((error, req, res, _next) => {
  if (error?.code === 11000) return res.status(409).json({ error: 'A record with that identifier already exists' });
  if (error?.message === 'Origin is not allowed') return res.status(403).json({ error: 'Origin is not allowed' });
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is invalid' });
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  console.error('Unhandled request error', { requestId: req.requestId, error: error?.message });
  return res.status(500).json({ error: 'Internal service error' });
});

const server = app.listen(env.port, () => console.log(`SENSE platform API listening on ${env.port}`));
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

async function shutdown(signal) {
  console.log(`${signal} received`);
  server.close(async () => {
    await client.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
