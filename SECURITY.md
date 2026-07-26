# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through the repository's **Security** tab using a private vulnerability report. Do not open a public issue containing exploit details, credentials, customer information, or payment data.

Include the affected route or component, reproduction steps, expected impact, and any suggested mitigation. Maintainers should acknowledge a complete report within five business days.

## Operational rules

- Keep Stripe, Coinbase, MongoDB, JWT, and owner-account credentials in the deployment provider's encrypted environment settings.
- Never commit `.env` files, payment secrets, webhook secrets, database URLs, or production tokens.
- Rotate an exposed secret immediately and revoke affected sessions.
- Treat payment state as authoritative only after a verified provider webhook.
- Review privileged activity in Command Administration's audit log.

Only the latest release on the default branch receives security updates.
