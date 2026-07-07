# @vmp/payments

Pluggable payment providers for VMP billing.

## Providers

| ID | Status | Default enabled |
|---|---|---|
| `stripe` | Production | Yes |
| `qerko` | Production (legacy eshop / migration) | Only when listed in tenant settings |
| `gopay` | Stub (`NotImplementedError`) | No |
| `comgate` | Stub (`NotImplementedError`) | No |

Admin settings still store `legacy` in CSV lists; the registry normalizes that to `qerko`. D1 `subscriptions.provider` continues to use `legacy` for Qerko rows.

## Tenant configuration

`payments_enabled_providers` and `payment_provider_order` in `admin_settings` control which providers are active, e.g.:

- Fresh launch: `stripe`
- Migrated tenant: `stripe,legacy` (parsed as `stripe,qerko`)

`createEnabledProviders(enabledIds, config)` returns a `Map` of configured provider instances. Billing code must resolve the provider from this map — never import Stripe or Qerko SDKs directly.

## Capabilities

Each provider exposes `capabilities`:

- `newSubscriptions` — may onboard brand-new subscribers (Qerko: **false**)
- `migrationOnly` — only for pre-existing platform subscribers (Qerko: **true**)
- `recurringPayments`, `refunds`, `webhooks` — feature flags for future UI/guards

Checkout must gate on `provider.capabilities.newSubscriptions` instead of hardcoded provider IDs.

## Adding a provider

1. Add `src/providers/<id>/index.ts` exporting `createXProvider(config): PaymentProvider`.
2. Register in `src/registry.ts` `PROVIDER_FACTORIES`.
3. Wire config in the API composition root (`packages/api/src/paymentProviders.ts`).
4. Add webhook route `/api/payments/webhook/<id>` or dispatch by path.

GoPay / Comgate are registered stubs — enable in settings only after real implementations land.

## GoPay / Comgate assumptions (confirm with product)

Stub capabilities are set to `{ newSubscriptions: true, migrationOnly: false, recurringPayments: true, refunds: true, webhooks: true }`. Treat as placeholder until PSP contracts are finalized.
