# Deployment

## Frontend

The repository root is a static PWA. Deploy it to GitHub Pages, Cloudflare Pages, Netlify, Render Static Sites, S3/CloudFront, or another static host.

Set `config.js` to the production API origin. When changing the frontend domain, update:

- `CORS_ORIGINS`
- `FRONTEND_URL`
- the `connect-src` API origin in `index.html`
- Stripe Checkout return URLs through the backend environment
- Coinbase Checkout redirect URLs through the backend environment

## API

The backend requires Node.js 20 or newer and MongoDB. The root `render.yaml` and `backend/render.yaml` both deploy the checked-in backend source directly.

Required environment:

- `MONGODB_URI`
- `JWT_SECRET`
- `MFA_ENCRYPTION_KEY`
- `ADMIN_EMAIL`
- `OWNER_BOOTSTRAP_TOKEN`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `CORS_ORIGINS`
- `FRONTEND_URL`

Security environment:

- `REQUIRE_ADMIN_MFA=true`
- `REQUIRE_EMAIL_VERIFICATION=true`
- `SESSION_HOURS=12` (maximum accepted value is 24)
- `COOKIE_SAME_SITE=None` while GitHub Pages and the API use unrelated domains

Generate each application secret independently with a cryptographically secure generator. Never reuse payment, database, session, MFA, or owner-bootstrap secrets.

Verify the sender domain with the transactional email provider before enabling public registration. Verification emails expire after 24 hours; password reset links expire after 30 minutes and revoke every existing session.

Payment environment:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `COINBASE_KEY_NAME`
- `COINBASE_KEY_SECRET`
- `COINBASE_WEBHOOK_SECRET`

Coinbase private-key newlines may be stored as escaped `\n`. The application restores them before signing short-lived request JWTs.

## First owner

Set `ADMIN_EMAIL` and `OWNER_BOOTSTRAP_TOKEN` before the first registration. Register that exact normalized email and open **Setting up the first owner?** to provide the deployment token. The account receives the `owner` role only when both values match. Immediately enable MFA, save the recovery codes offline, and rotate `OWNER_BOOTSTRAP_TOKEN`.

No default admin or user password is created. Do not send credentials in source control, issues, chat, analytics, or logs.

## Webhooks

Use the public API origin:

- Stripe: `POST /api/webhooks/stripe`
- Coinbase Business: `POST /api/webhooks/coinbase`

Do not fulfill an order from the browser redirect alone. The backend changes payment state only after webhook signature validation.

## Production boundary

GitHub Pages hosts only public static files. Run the API on an application host and MongoDB on a managed database service. Keep all secrets server-side. For production, use custom sibling domains such as `app.example.com` for GitHub Pages and `api.example.com` for the API; then set both origins explicitly and change `COOKIE_SAME_SITE=Lax`.

At the database layer, use a dedicated least-privilege application user, TLS, restricted network access, encrypted backups, and tested point-in-time restoration. Do not use an all-clusters administrative database credential.

## GitHub controls

Before launch, enable branch protection, required pull-request review, required Quality/Security checks, secret scanning, push protection, Dependabot alerts, and private vulnerability reporting. Keep GitHub Actions permissions read-only unless a specific deployment or security upload needs more.
