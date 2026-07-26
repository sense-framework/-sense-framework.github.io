# Deployment

## Frontend

The repository root is a static PWA. Deploy it to GitHub Pages, Cloudflare Pages, Netlify, Render Static Sites, S3/CloudFront, or another static host.

Set `config.js` to the production API origin. When changing the frontend domain, update:

- `CORS_ORIGINS`
- `FRONTEND_URL`
- Stripe Checkout return URLs through the backend environment
- Coinbase Checkout redirect URLs through the backend environment

## API

The backend requires Node.js 20 or newer and MongoDB. The root `render.yaml` and `backend/render.yaml` both deploy the checked-in backend source directly.

Required environment:

- `MONGODB_URI`
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `CORS_ORIGINS`
- `FRONTEND_URL`

Payment environment:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `COINBASE_KEY_NAME`
- `COINBASE_KEY_SECRET`
- `COINBASE_WEBHOOK_SECRET`

Coinbase private-key newlines may be stored as escaped `\n`. The application restores them before signing short-lived request JWTs.

## First owner

Set `ADMIN_EMAIL` before the first registration. Register that exact normalized email through the site. It receives the `owner` role. Additional privileged roles must then be granted through Command Administration.

## Webhooks

Use the public API origin:

- Stripe: `POST /api/webhooks/stripe`
- Coinbase Business: `POST /api/webhooks/coinbase`

Do not fulfill an order from the browser redirect alone. The backend changes payment state only after webhook signature validation.
