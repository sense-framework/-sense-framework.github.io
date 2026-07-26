# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through the repository's **Security** tab using a private vulnerability report. Do not open a public issue containing exploit details, credentials, customer information, or payment data.

Include the affected route or component, reproduction steps, expected impact, and any suggested mitigation. Maintainers should acknowledge a complete report within five business days.

## Operational rules

- Keep Stripe, Coinbase, MongoDB, session-signing, MFA-encryption, and owner-bootstrap credentials in the deployment provider's encrypted environment settings.
- Never commit `.env` files, payment secrets, webhook secrets, database URLs, or production tokens.
- Use different random values for `JWT_SECRET`, `MFA_ENCRYPTION_KEY`, and `OWNER_BOOTSTRAP_TOKEN`.
- Rotate an exposed secret immediately, revoke affected sessions, and review the audit trail and provider activity.
- Treat payment state as authoritative only after a verified provider webhook.
- Review privileged activity in Command Administration's audit log.
- Require MFA for every owner and administrator. Store recovery codes offline and separately from the password.
- Keep MongoDB off the public internet where private networking is available. Otherwise allow only the API provider's outbound addresses and require TLS.
- Protect the default branch, require Quality and Security checks, require review, dismiss stale approvals, block force pushes, and enable secret scanning and push protection.
- Run the API and database with least privilege. The API database user must not have cluster-administration permissions.
- Do not place secrets in GitHub Pages, `config.js`, browser storage, analytics properties, logs, or client bundles.

## Session design

The browser receives an opaque, random session cookie. Only a SHA-256 digest is stored in MongoDB. The cookie is HTTP-only, secure in production, host-only, time-limited, and paired with an origin-bound CSRF token kept only in browser memory. Signing out or changing a role revokes server-side sessions.

While the frontend remains on `github.io` and the API remains on `onrender.com`, `COOKIE_SAME_SITE=None` is required because they are cross-site. For the strongest and most reliable browser behavior, use custom sibling domains such as `app.example.com` and `api.example.com`, then change the cookie setting to `Lax`. GitHub Pages can still host the frontend source and deployment.

## Incident response

1. Disable affected accounts or payment routes.
2. Preserve deployment, audit, payment-provider, and database logs.
3. Rotate the affected provider keys and application secrets.
4. Revoke all sessions and require password resets when authentication material may be exposed.
5. Reconcile orders against signed payment-provider events.
6. Patch, test, deploy, and document the incident without publishing customer data or exploit details.

Only the latest release on the default branch receives security updates.
