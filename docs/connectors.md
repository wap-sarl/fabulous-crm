# Connectors

The connector foundation lets each user connect their Google or Microsoft account to the CRM.
It stores the account and its tokens and keeps an access token fresh; the features that use an
account (calendar, e-mail sync) build on it and bring their own scopes. Code:
`convex/lib/connectors.ts`, `convex/features/connectors/`, the page under
« Intégrations » (`/settings/integrations`).

## Credentials

A provider can be connected when an OAuth app is available for it, from one of two sources:

| Source | Where | When it is used |
|---|---|---|
| `own` | « Intégrations » → *Applications OAuth de votre organisation* (client id, secret stored as ciphertext in `appConfig.connectors`) | when configured and enabled: it always wins |
| `managed` | the deployment environment: `CONNECTOR_GOOGLE_CLIENT_ID` / `_CLIENT_SECRET`, `CONNECTOR_MICROSOFT_CLIENT_ID` / `_CLIENT_SECRET` | otherwise, when both variables of the provider are set (a host supplying its own registered apps) |

Register the redirect address shown on the page in the provider's console. Requested scopes:
`openid email profile` (Google, with offline access), `openid email profile offline_access`
(Microsoft). They identify the account and nothing more.

## The flow

1. `startConnection` stores a one-time row (`connectorStates`: the hashed nonce, the user, a
   PKCE verifier, ten minutes to live) and returns the provider's consent URL with a signed
   `state` and the PKCE challenge.
2. The provider sends the browser back with `code` and `state` to the redirect address (below).
3. `GET /connectors/callback` on this deployment verifies the state's signature and expiry,
   consumes the row (a replayed callback finds nothing), exchanges the code **here** with the
   client secret and the PKCE verifier, and reads the account's identity from the ID token
   (`sub`; `oid` for Microsoft, whose `sub` changes with the app registration). It links
   nothing yet: the grant is parked in `connectorPendingAccounts`, tokens as ciphertext
   (`lib/crypto.ts`), under the hash of a one-time **finish token**, five minutes to live. The
   browser lands on « Intégrations » with `#finish=<token>` (a fragment: it reaches neither a
   server log nor a referrer), `?error=<code>`, or `#failed=<token>` when the provider said
   something about a failure (below).
4. The page calls `finishConnection({ token })`, signed in. The account is linked only when the
   caller is the user who started the connection: one account per user and provider. Anyone
   else, or a late token, burns it, and the parked grant is revoked at the provider; so is a
   grant nobody claimed, swept by a later callback.
5. `internal.features.connectors.actions.accessToken` serves a valid access token to the
   features, refreshing it a minute before it expires. A refresh the provider refuses
   (`invalid_grant`) marks the account `error` (« À reconnecter »); anything else is treated as
   transient. There is no single-flight: two callers refreshing the same account at the same
   moment both reach the token endpoint. The first feature that calls it concurrently should
   add a lock or a "refresh in progress" marker.
6. Disconnecting hides the account at once, revokes the grant at the provider when it has an
   endpoint for that (Google; Microsoft has none for a refresh token), then deletes the row.
   A user who reconnects before that ran keeps the fresh grant: the revocation steps aside.

### The authorisation code never reaches a page

`/connectors/callback` is an HTTP action: it renders nothing and answers with a redirect of its
own (`Cache-Control: no-store`). No page therefore ever has the code in its address, so no
referrer can carry it and no script on a page can read it; the code is spent server-side
before the browser lands anywhere. The finish token travels in the fragment for the same
reason. A dispatcher in front (below) forwards with `Referrer-Policy: no-referrer`; that is
belt and braces, the property comes from here.

### When the provider says no

A refusal by the user or a failure at the provider comes back as `error` and, often,
`error_description`. The page maps the codes it knows (ours, and `access_denied`) to its own
sentences; for any other code it shows a generic message with the provider's words under it,
attributed (« Message du fournisseur : … »).

**Free text never travels in an address.** Both `/connectors/callback` and
`/settings/integrations` can be crafted by anyone and sent to a signed-in user, so whatever
the page read from its own query string could be made to say anything inside the CRM. The
page therefore reads **a code and nothing else** from its address (`?error=`), and the
provider's words take the same road as a connected account:

1. The callback makes the description one line, strips control characters and cuts it at 300
   characters (`providerErrorDescription`). It keeps it only for a `state` signed here, not
   expired, **whose connection is still open**: the state row is consumed (the refused
   connection is over) and the text is parked in `connectorFailures` for the user who started,
   under the hash of a one-time token, five minutes to live. A failed code exchange parks
   what the token endpoint said the same way, for the same user.
2. The browser lands on « Intégrations » with `#failed=<token>`.
3. The page calls `claimFailure({ token })`, signed in. The text is returned once, only to the
   user who started the connection; anyone else, a second call or a late one gets nothing and
   burns the token. Rows nobody claimed are swept by a later failure.

Without a description, or without a state of ours, the landing is `?error=<code>` as before.

### Why the callback does not link the account

The callback is reached without a session (another origin, no cookie), and the state only says
who *started* the connection. Linking there would let a user send their own consent URL to
someone else and receive that person's tokens on their CRM account. The finish token goes to
the browser that consented, and `finishConnection` requires that browser to be signed in as
the user who started: the person who consents and the account that receives are the same.

No query returns a token, in clear or not. Connections and disconnections are audited
(`connectorAccount`) without any token.

## The two callback modes

| `OAUTH_CALLBACK_BASE` | Redirect address | Who receives the provider's redirect |
|---|---|---|
| unset | `${CONVEX_SITE_URL}/connectors/callback` | this deployment |
| set | `${OAUTH_CALLBACK_BASE}/oauth/callback` | a **callback dispatcher**, which forwards the browser to this deployment's `/connectors/callback` with the same `code` and `state` |

The second mode exists for hosts that serve many deployments under per-tenant hostnames:
providers refuse wildcard redirect addresses, so one registered callback serves them all.

### What a dispatcher must do

- Validate the `state` before forwarding: `state = base64url(JSON) + "." + base64url(HMAC-SHA256)`.
  The JSON is `{ "t": <OAUTH_CALLBACK_TENANT>, "p": "google"|"microsoft", "n": <nonce>, "e": <expiry, Unix seconds> }`;
  the MAC is computed over the base64url body, under the key `"connector-state:" + OAUTH_STATE_SECRET`.
- Route on `t`, refuse an expired or badly signed state, and redirect the browser to that
  deployment's `/connectors/callback?code=…&state=…` (or `?error=…&state=…`, with the provider's
  `error_description` next to `error` when there is one: forward the `state` with it, the
  deployment only keeps the description of a connection it started and that is still open).
- Never exchange the code. It could not: the exchange needs the client secret and the PKCE
  verifier, and the verifier never leaves this deployment. Replay protection also stays here
  (the nonce is consumed by the deployment), so a dispatcher may stay stateless.

With one `OAUTH_STATE_SECRET` for every deployment behind a dispatcher, a deployment can sign a
state that routes to another one. It goes no further: the receiving deployment finds no
connection in progress under that nonce and refuses. A routing nuisance, not a way in.

`OAUTH_STATE_SECRET` is shared between the deployment and its dispatcher; without a dispatcher
it may stay unset, the state is then signed under a key derived from `BETTER_AUTH_SECRET`.

## Secrets

Tokens and the OAuth app's secret follow `docs/secrets.md`. Two migrations cover the tokens:
`migrations:encryptConnectorTokens` (values written before `SECRETS_KEY` existed) and
`migrations:rotateConnectorTokens` (rotation with `SECRETS_KEY_NEXT`), next to the
`appConfig` ones, which now include the connector apps' secrets. Parked grants
(`connectorPendingAccounts`) live five minutes and are covered by neither.
