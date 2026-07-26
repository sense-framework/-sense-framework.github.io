# Operations

## Roles

| Role | Operational scope |
|---|---|
| Owner | Every platform capability and owner-role control |
| Administrator | Users, catalog, orders, memberships, chats, analytics, settings, audit, broadcasts |
| Support | Users, orders, memberships, and chats |
| Editor | Catalog and theme/content settings |
| Analyst | Analytics, orders, and memberships |
| Member | Personal workspace, shop, memberships, orders, and messages |

Role or suspension changes revoke the target account's existing token.

## Commerce

Products begin as drafts. Publish them by changing status to `active`. Inventory is decremented only after confirmed payment. Archived products remain available in prior order snapshots.

Orders use separate payment and fulfillment states. This prevents a paid order from being confused with a shipped or delivered order.

## Memberships

Stripe memberships use recurring provider subscriptions and the Stripe customer portal. Coinbase memberships are prepaid periods because blockchain checkout is a single-use payment. Webhook delivery extends or activates access.

## Moderation

Hiding a message preserves it for audit and investigation while replacing its content in member conversations. Soft deletion removes it from conversation and moderation lists without rewriting audit history.

## Analytics and privacy

The analytics endpoint accepts bounded event names and small, sanitized property sets. Raw analytics expire after two years. Do not place passwords, payment credentials, message bodies, or sensitive personal data in analytics properties.

## Backups

Back up MongoDB independently of the static frontend. At minimum, include users, products, membership plans, orders, memberships, messages, workspace states, settings, and audit events.
