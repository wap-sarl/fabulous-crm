# Editions

Fabulous CRM ships in two editions built from this single repository.

## Community Edition

Everything outside the `ee/` directory, under the [Apache 2.0 licence](LICENSE). It is the
complete product: contacts, companies, deals and pipelines, activities, lists, custom
properties, scoring, e-mail and SMS campaigns through your own Brevo account, workflows,
capture forms, consent management, timeline, audit log, roles and teams, SSO, CSV import, the
public REST API with its OpenAPI documentation, and the setup wizard.

Features that exist in the Community Edition stay in it. Anything required by law, such as
data-subject rights, retention purges and accessibility, is never a paid feature.

Self-host it with the instructions in the [README](README.md).

## Hosted edition (SaaS)

The same code, run by WAP SARL for you. It adds hosting, backups, updates and support, and
the paid features that live in `ee/`: outgoing webhooks, managed connectors, SSO
enforcement, and more over time. Paid features are unlocked by a signed entitlement issued
with a subscription; without one, a deployment behaves exactly like the Community Edition.

The `ee/` directory is source-available under the [Enterprise Edition licence](LICENSE.ee):
you can read, modify and test it, and use it in production with a subscription.

## How the switch works

- The backend reads `EDITION`, `TENANT_ID`, `TENANT_STATUS` and `ENTITLEMENTS` from its
  environment (rows in the README table). `ENTITLEMENTS` is a token signed by the control
  plane and verified against the public keys compiled into `convex/lib/entitlementsKeys.ts`;
  without a valid one, every gate answers as the Community Edition. Nothing in the
  environment alone can unlock a paid feature.
- The SPA resolves `@crm/ee` to `src/ee-stubs/` by default and to `ee/src/` when Vite runs
  with `EE=1`; `bun run typecheck:ee` checks that build. The backend ships `convex/ee/` stubs;
  `bun run ee:enable` copies `ee/convex/` over them for a hosted build (never commit that
  state; `bun run ee:disable` restores the stubs).
- For local testing, `bun run entitlements:sign --tenant <TENANT_ID> --features webhooks`
  prints a token signed with a throwaway key pair and the public key to add to
  `entitlementsKeys.ts` temporarily.
