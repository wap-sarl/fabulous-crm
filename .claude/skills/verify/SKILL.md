---
name: verify
description: How to verify wap-crm changes at runtime against the dev Convex deployment (read `.env.local` for the current handle)
---

# Verifying wap-crm changes

## Deployment handles
- Dev deployment: **read `CONVEX_DEPLOYMENT` in `.env.local`** (it changes when the user switches Convex projects — never hardcode it here). Cloud URL `https://<handle>.convex.cloud`, HTTP-actions URL `https://<handle>.convex.site`.
- A freshly switched deployment starts with almost no env vars: `SITE_URL` (required — Better Auth trustedOrigins; without it every social/SSO login start dies on CORS with « Impossible de démarrer la connexion »), `DEV_WHITELIST_EMAILS`/`DEV_WHITELIST_PHONES`, and the email provider config in `appConfig` may all be missing. Check `bunx convex env list` first.
- Push backend changes: `bunx convex dev --once` (also run `bun run codegen` first if validators/schema changed — `convex/_generated` is committed).
- Env vars: `bunx convex env set NAME value` / `bunx convex env list`.

## Driving backend surfaces without UI login
Better Auth OTP blocks headless browser login (no seed/devSession backdoor). Work around it:
- **HTTP actions** (`convex/http.ts` routes): curl `https://<handle>.convex.site/<path>` directly.
- **Public mutations/queries**: `bunx convex run features/crm/mutations:updateConsentByToken '{"token":"…","channels":["sms"]}'` — handy to put a lead in a desired consent state (tokens visible in `bunx convex data leads`).
- **Inspect state**: `bunx convex data <table> --limit N` (leads, campaignSends, leadNotes…). Wide tables: grep the row by `_id`.

## Test data
The dev deployment has real leads/campaigns. The account owner keeps a personal test lead there (identify it from `.env.local` / ask the user) — safe to mutate, but restore its prior state afterwards. Treat every other row as real personal data: never copy lead identities, emails or phone numbers into commits, issues or logs. `campaignSends` rows from real SMS campaigns carry genuine `brevoMessageId`s usable to simulate Brevo webhook events.

## Gotchas
- SMS/email sends in dev are gated by `DEV_WHITELIST_PHONES` / `DEV_WHITELIST_EMAILS`; non-whitelisted recipients are marked sent with `brevoMessageId: 'dev_whitelist_skip'`.
- Frontend runs in the `wap-crm-dev` container on the `proxy` docker network (no published ports).
