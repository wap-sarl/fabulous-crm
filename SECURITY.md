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
and the public surfaces (capture forms, consent links, Brevo webhooks). Third-party services
(Convex, Brevo) have their own programmes.
