# Extension seam

The CRM exposes a small set of hook points so a deployment can add rules, pages and routes
without forking the code. A deployment *overlay* replaces two files and, optionally, adds
tables; everything else in the repository stays untouched.

| File | Replaced by an overlay | Purpose |
|---|---|---|
| `convex/extensions.ts` | yes | backend hooks, exported as `extensions` |
| `convex/extensionsSchema.ts` | yes | extra tables merged into `defineSchema` |
| `src/extensions.tsx` | yes | extra routes, nav items and a shell guard for the SPA |
| `convex/lib/extensionTypes.ts` | no | the backend contract and its no-op defaults |
| `src/lib/extensionTypes.ts` | no | the frontend contract |

## Backend hooks

| Hook | Called from | Effect of the return value |
|---|---|---|
| `beforeEmployeeCall(ctx)` | first line of `employeeQuery`, `employeeMutation`, `settingsQuery`, `settingsMutation`, `employeeAction` | throw to refuse the call |
| `publicConfig(ctx)` | `getPublicConfig`, before login | fields merged into the public config (core fields win) |
| `beforeInvitation(ctx, { stage, pending })` | invitation creation (`stage: 'create'`) and acceptance in the Better Auth provisioning hook (`stage: 'accept'`); `pending` = open invitations | throw to refuse |
| `beforeLeadCreate(ctx, { count, source })` | a lead becoming live: creation (`crm`), CSV import (`import`, `count` = rows that will create or revive a lead, after matching and validation — rows updating a live lead and invalid rows do not count) and the public API (`api`, creation and revival by upsert) | throw to refuse |
| `beforeSend(ctx, info)` | campaigns at four stages — `create` (`count: 1`, before any recipient is materialised), `preparing` (each 200-lead preparation page, `count` = recipients with a contact so far), `prepared` (last page, final count) and `resend` (retry of one send or resend of all, `count` = messages re-queued) — and each workflow send step (`count: 1`) | throw to refuse: `create` and `resend` propagate the error to the caller; `preparing` / `prepared` mark the campaign `failed` with the code in `failureReason`; a workflow step is logged `skipped` with the code |
| `beforeWorkflowRun(ctx, workflow)` | every enrollment | `false` skips the enrollment; the host write succeeds |
| `beforeApiRequest(ctx, key, method)` | after API authentication and rate limits | a `{ status, code, message, details? }` answers instead of the route |
| `beforeScheduledWork(ctx, { kind })` | the background entry points: `campaign_prepare` (`prepareCampaignBatch`), `campaign_drain` (`sendCampaignBatch`), `workflow_step` (`executeStep`), `workflow_action` (`runWorkflowActionStep`) | `false` defers: the same function is rescheduled `SCHEDULED_WORK_RETRY_MS` (15 min) later and nothing changes, so background work pauses and resumes on its own |
| `registerHttpRoutes(http)` | `convex/http.ts`, before the `/api/v1/` routes | register extra routes |

The recipient count of a campaign is not known at creation: resolving it means scanning
every lead, which is exactly why preparation runs in pages. `create` therefore only asks
whether at least one message may go out, and the running count is checked again on every
page, so a refused campaign writes at most one page of sends past the limit before it is
marked `failed`. Overlays that reserve quota should do it at `prepared`.

## What each gate is asked to bill

The core invokes the seam from one place, `convex/lib/gates.ts`, whose helpers are named after
the unit they bill: `gateLeadCreate`, `gateInvitation`, `requireSendAllowed` and `trySend`, and
`deferUnlessAllowed` for the background entry points.

The CRM passes a business unit, never a technical count, so an overlay can meter on it: check
at intent, charge at effect.

| Gate | Unit | Intent or effect |
|---|---|---|
| `beforeInvitation` | one seat; `pending` = open invitations an overlay may count as reserved | intent at `create`, effect at `accept` |
| `beforeLeadCreate` | leads becoming live: created, or revived from a soft delete; for an import, counted after matching and validation | effect |
| `beforeSend`, campaign `create` | 1: at least one message will go out | intent |
| `beforeSend`, campaign `preparing` | the recipients with a contact so far | intent |
| `beforeSend`, campaign `prepared` | the recipients with a contact, final | effect |
| `beforeSend`, campaign `resend` | the messages re-queued | effect |
| `beforeSend`, workflow | one message | effect |
| `beforeWorkflowRun` | one enrollment | effect |
| `beforeApiRequest` | one authenticated request | effect |

## Refusals

A hook refuses by throwing. Throw a `ConvexError` whose data is `{ code, ...details }` to give
clients a structured reason, for example `{ code: 'quota_exceeded', quota: 'emails', limit: 1000,
used: 1000 }`; a plain `Error` refuses with its message as the code. `refusalCode(error)` in
`convex/lib/extensionTypes.ts` extracts the code on the server; `refusalOf(error)` in
`src/lib/errors.ts` does the same on the client, and `describeError(error, fallback)` asks the
overlay's `describeRefusal` for a user message before falling back. The generic error toasts of
the lead, company, deal and activity dialogs, the CSV import, the team invitation and the
campaign creation go through it.

Hooks receive the same `ctx` as the caller and run inside its transaction: a thrown error
rolls the caller back. Keep them cheap; they run on every call.

## Frontend

`src/extensions.tsx` exports `extensions: FrontendExtensions`:

- `routes`: mounted inside the authenticated shell (`DashboardShell`), after the built-in pages.
- `navItems`: appended to the sidebar and filtered like the built-in items: `requires: 'settings'`
  hides an entry from users without the settings switch; a path under a module follows the
  role's access to that module.
- `ShellGuard`: a component wrapping the shell; render `children` to show the app, or
  something else (a billing page, a maintenance notice) to replace it.
- `describeRefusal`: optional; turns one of the overlay's refusal codes (with the ConvexError
  data) into a user message, null for codes it does not own.

## Tests

`setExtensionsForTests(overrides)` in `convex/extensions.ts` swaps hooks for the duration of a
`bun:test` case, since the functions run in-process; pass `null` to restore the defaults. See
`tests/backend/extensions.test.ts`.
