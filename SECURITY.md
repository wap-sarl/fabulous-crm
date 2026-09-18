# Security policy

## Reporting a vulnerability

Please do not open a public issue. E-mail **security@w-ap.ch** with a description of the
problem, the steps to reproduce it and, if you have one, a fix or a mitigation. You will get
an acknowledgement within three business days and a fix or a plan within thirty days for
confirmed issues. We credit reporters in the release notes unless they prefer otherwise.

## Supported versions

Only the `main` branch and the latest release tag receive security fixes.

## Scope

The application code in this repository, including the public REST API under `/api/v1/`
and the public surfaces (capture forms, consent links, Brevo webhooks, the connectors' OAuth
callback `/connectors/callback`). Third-party services
(Convex, Brevo) have their own programmes.

## Connected accounts

Connecting a Google or Microsoft account (`docs/connectors.md`) requests the identity scopes
only: `openid`, `email`, `profile`, plus offline access so the connection outlives the session.
Features that need more (calendar, e-mail) will ask for their own scopes when they arrive, and
say so here. Refresh and access tokens are stored encrypted (`SECRETS_KEY`), are never returned
to the browser, and are revoked at the provider on disconnection when it offers an endpoint for
that. The authorisation code is exchanged by the deployment itself, with PKCE; a callback
dispatcher in front of it only forwards the code and cannot redeem it.
