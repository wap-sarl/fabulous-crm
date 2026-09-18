# Secrets at rest

The five secrets a deployment stores in `appConfig` (`email.brevoApiKey`,
`email.brevoWebhookSecret`, `email.smtpPass`, `auth.socialProviders[].clientSecret`,
`auth.ssoProviders[].clientSecret`) are written as ciphertext when `SECRETS_KEY` is set:
AES-256-GCM through Web Crypto, one random nonce per write, `v1:<nonce>:<ciphertext>` in base64
(`convex/lib/crypto.ts`, `encryptSecret` / `decryptSecret`). They are decrypted only where they
are used: the Better Auth request handler (`createAuth`), `resolveEmailProvider` and
`resolveBrevo`. Queries never return a clear value; the settings screens see presence flags.

Without `SECRETS_KEY` the community edition keeps working with secrets in clear and logs a
warning on the first write. A hosted deployment always sets it.

## Turning encryption on for an existing deployment

```sh
bunx convex env set SECRETS_KEY $(openssl rand -hex 32) --prod
bunx convex deploy
bunx convex run migrations:run '{"fn":"migrations:encryptAppConfigSecrets"}' --prod
bunx convex run migrations:run '{"fn":"migrations:encryptConnectorTokens"}' --prod
```

The second line covers the tokens of connected accounts (`docs/connectors.md`). New writes are encrypted from the moment the key exists; the migration encrypts what was
written before it, once, and leaves ciphertext alone. Keep the key in the password manager:
losing it loses every stored secret (they can be re-entered in the settings).

## Rotating the key

Reads try `SECRETS_KEY_NEXT` first, then `SECRETS_KEY`; writes use `SECRETS_KEY_NEXT` when it
exists. Nothing is interrupted.

1. `bunx convex env set SECRETS_KEY_NEXT $(openssl rand -hex 32) --prod`
2. `bunx convex run migrations:run '{"fn":"migrations:rotateAppConfigSecrets"}' --prod`
   re-encrypts every stored secret with the new key; run `migrations:rotateConnectorTokens`
   the same way for the tokens of connected accounts.
3. Promote it: `bunx convex env set SECRETS_KEY <the new key> --prod`, then
   `bunx convex env remove SECRETS_KEY_NEXT --prod`.

Step 3 before step 2 would leave secrets nobody can decrypt: `decryptSecret` answers
`secret_key_mismatch` and the affected feature (sign-in through that provider, sending) fails
until the old key is put back.

## Migrations

`convex/migrations.ts` holds the online migrations (`@convex-dev/migrations`), run with
`bunx convex run migrations:run '{"fn":"migrations:<name>"}'`. They are idempotent and resume
where they stopped; `appConfig` is a single document, so both finish in one batch.
