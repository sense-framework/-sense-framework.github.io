# SENSE Platform

SENSE is a production-oriented company platform with a static progressive web frontend and a Node.js/MongoDB API.

The public entry remains intentionally minimal. Authenticated users receive the workspace, shop, memberships, orders, messaging, and account tools. Authorized operators receive Command Administration for users, catalog, orders, memberships, message moderation, analytics, payment status, appearance, broadcasts, and audit history.

## Platform capabilities

- Real registration and login with email verification, one-time password resets, 15-character passphrases, memory-hard scrypt hashing, legacy bcrypt migration, server-side revocable sessions, CSRF protection, lockouts, MFA, and privileged reauthentication
- Owner, administrator, support, editor, analyst, and member roles
- Product catalog, inventory tracking, carts, order history, fulfillment, and refunds
- Recurring card memberships through Stripe and prepaid crypto memberships through Coinbase Business Checkout
- Verified Stripe and Coinbase webhooks before orders or memberships are activated
- Member billing portal through Stripe
- Persistent workspace and business-module state
- Direct member messaging with administrative search, hide, restore, and soft-delete controls
- Server-side page, signup, checkout, purchase, revenue, and chat analytics
- Live theme tokens and feature controls managed from Command Administration
- Audit records for privileged and security-sensitive actions
- Installable PWA shell with offline static assets

There are no temporary administrator accounts, preloaded users, fake orders, sample products, or seeded analytics.

## Local frontend

Serve the repository root with any static web server:

```sh
python3 -m http.server 5500
```

Copy `config.example.js` to `config.js` when targeting a different API.

## API

```sh
cd backend
npm install
cp .env.example .env
npm run dev
```

MongoDB, `JWT_SECRET`, and a separate `MFA_ENCRYPTION_KEY` of at least 32 characters are required. The account matching `ADMIN_EMAIL` becomes the initial owner only when registration also supplies the `OWNER_BOOTSTRAP_TOKEN`. Enable MFA immediately, save the recovery codes offline, then rotate the bootstrap token.

## Payments

Card checkout, recurring subscriptions, billing management, and card refunds use Stripe. Crypto checkout and crypto refunds use Coinbase Business Checkout. Orders remain pending until a signed webhook confirms payment.

Set the provider credentials in the backend environment and register:

- `https://YOUR_API/api/webhooks/stripe` in Stripe
- `https://YOUR_API/api/webhooks/coinbase` in Coinbase Business

The Payment Operations page reports whether each provider and webhook secret is configured without exposing credentials.

## Deployment

The frontend can remain on GitHub Pages or move to any static host. The API is deployable from either `render.yaml`. GitHub Pages never receives database, session, payment, or encryption secrets. Update `CORS_ORIGINS`, `FRONTEND_URL`, `config.js`, and the frontend CSP when the public domains change.

See [Theming](docs/THEMING.md), [Deployment](docs/DEPLOYMENT.md), and [Operations](docs/OPERATIONS.md).
