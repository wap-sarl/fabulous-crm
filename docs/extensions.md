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
| `beforeSignInCode(ctx, { email, type })` | `deliverSignInCode` in `convex/auth.ts`, the scheduled action that e-mails a sign-in code: after the per-address rate limit and the `magicLinkEnabled` toggle, before anything is sent; `email` is trimmed and lower-cased, `type` is `'sign-in'` | throw to refuse: nothing is sent and **the requester is told nothing**, neither by the answer nor by its speed (see Sign-in) |
| `beforeInvitation(ctx, { stage, pending })` | invitation creation (`stage: 'create'`) and acceptance in the Better Auth provisioning hook (`stage: 'accept'`); `pending` = open invitations | throw to refuse |
| `beforeLeadCreate(ctx, { count, source })` | a lead becoming live: creation (`crm`), CSV import (`import`, `count` = the rows of the import, updates and invalid rows included, by decision: no matching pass before the gate) and the public API (`api`, creation and revival by upsert) | throw to refuse |
| `beforeSend(ctx, info)` | campaigns at four stages — `create` (`count: 1`, before any recipient is materialised), `preparing` (each 200-lead preparation page, `count` = recipients with a contact so far), `prepared` (last page, final count) and `resend` (retry of one send or resend of all, `count` = messages re-queued) — and each workflow send step (`count: 1`) | throw to refuse: `create` and `resend` propagate the error to the caller; `preparing` / `prepared` mark the campaign `failed` with the code in `failureReason`; a workflow step is logged `skipped` with the code |
| `beforeWorkflowRun(ctx, workflow)` | every enrollment | `false` skips the enrollment; the host write succeeds |
| `beforeApiRequest(ctx, key, method)` | after API authentication and rate limits | a `{ status, code, message, details? }` answers instead of the route |
| `beforeScheduledWork(ctx, { kind })` | the background entry points: `campaign_prepare` (`prepareCampaignBatch`), `campaign_drain` (`sendCampaignBatch`), `workflow_step` (`executeStep`), `workflow_action` (`runWorkflowActionStep`) | `false` defers: the same function is rescheduled `SCHEDULED_WORK_RETRY_MS` (15 min) later and nothing changes, so background work pauses and resumes on its own |
| `afterChange(ctx, change)` | through `notifyChange` in `convex/lib/observers.ts`: `logAudit` (every audited write of any entity: UI, public API, CSV import, workflows, system events) and `insertLifecycleHistory` (every lifecycle transition, whatever moved the lead) | none: an observer. It runs in the writer's transaction; what it throws is swallowed and traced, the write stands (see Changes) |
| `registerHttpRoutes(http)` | `convex/http.ts`, before the `/api/v1/` routes | register extra routes |

The recipient count of a campaign is not known at creation: resolving it means scanning
every lead, which is exactly why preparation runs in pages. `create` therefore only asks
whether at least one message may go out, and the running count is checked again on every
page, so a refused campaign writes at most one page of sends past the limit before it is
marked `failed`. Overlays that reserve quota should do it at `prepared`.

## What each gate is asked to bill

The core invokes the gates from one place, `convex/lib/gates.ts` (the `afterChange` observer
lives in `convex/lib/observers.ts`), whose helpers are named after
the unit they bill: `gateLeadCreate`, `gateInvitation`, `requireSendAllowed` and `trySend`, and
`deferUnlessAllowed` for the background entry points.

The CRM passes a business unit, never a technical count, so an overlay can meter on it: check
at intent, charge at effect.

| Gate | Unit | Intent or effect |
|---|---|---|
| `beforeInvitation` | one seat; `pending` = open invitations an overlay may count as reserved | intent at `create`, effect at `accept` |
| `beforeLeadCreate` | leads becoming live: created, or revived from a soft delete; for an import, every row of the import (updates and invalid rows included, by decision) | effect |
| `beforeSend`, campaign `create` | 1: at least one message will go out | intent |
| `beforeSend`, campaign `preparing` | the recipients with a contact so far | intent |
| `beforeSend`, campaign `prepared` | the recipients with a contact, final | effect |
| `beforeSend`, campaign `resend` | the messages re-queued | effect |
| `beforeSend`, workflow | one message | effect |
| `beforeWorkflowRun` | one enrollment | effect |
| `beforeApiRequest` | one authenticated request | effect |

## Changes

`afterChange` is how an overlay learns that something changed (outgoing webhooks, a search
index, a sync). A `change` is either `{ type: 'audit', entityType, entityId, action, userId?,
apiKeyId?, metadata? }`, the audit entry just written (`metadata.changes` carries the old and new
values of an update, `metadata.source` names a system writer: `import`, `workflow`,
`tracked_link`, `sms_stop`, `public_link`), or `{ type: 'lifecycle', leadId, from, to, source }`.

**What it reports.** Every write the CRM audits: contacts, companies, deals, activities, notes,
lists and the rest, made from the UI, the public API, a CSV import (created and updated rows
alike, a soft-deleted contact brought back being an `update` with `metadata.revived`), a
workflow's `update_property` step, a tracked-link click, an SMS STOP or the
preference link; and every lifecycle transition, including those no audit entry accompanies
(a won deal, a score threshold, a workflow's `set_lifecycle_stage`). **What it does not.**
Derived fields written without an audit entry: the score, `lastActivityAt` and the other
behavioural signals (the activity, the open or the click that moved them is what gets
reported), the search text, the duplicate keys and the aggregates. Cascades are reported by their cause only: a merge
is one `merge` on the survivor and one `delete` on the absorbed contact, not one update per
deal and activity re-parented; a deleted company is one `delete`, not one update per contact
detached from it. System notes (the STOP and tracked-link timeline notes) are not audited.

**Order and duplicates.** A contact's creation produces two changes, a manual stage change
too: the audit entry always comes first, then the lifecycle transition, in the UI, the API,
the import and the merge alike. Nothing orders the changes of different records within one
mutation. An overlay that emits one event per record should coalesce by record within the
transaction (key: `entityType` + `entityId`).

**Volume.** A CSV import calls the hook once per row, inside one mutation. Scheduling one
function per change would hit Convex's per-transaction limits on a large import: batch per
transaction, never per change.

**Failure.** The hook is an observer: what it throws never reaches the writer. Swallowed is
not rolled back, though. Convex has no savepoint, so whatever the hook wrote before throwing is
committed with the CRM's write. A hook must therefore be all-or-nothing on its side, or catch
its own errors. The pattern to use is the **outbox**: one cheap insert into an overlay table
inside the transaction, and the delivery, the retries and anything that can fail in a scheduled
function reading that table. With an outbox the only way to fail is for the transaction itself
to be in trouble.

The core does not alert. A failure is logged (`afterChange failed`) and leaves one row in
`auditLogs` (`entityType: 'appConfig'`, `entityId: 'extensions:afterChange'`,
`metadata.event: 'afterChange_failed'` with the code and the kind of change), at most one an
hour so a failing hook under a large import cannot flood the table, and the cap is looked up
once per mutation, so that import does not pay one read per row either. An overlay that must not
lose events watches that row, or its own outbox, itself.

**Imports.** `lib/audit.ts` and `lib/lifecycle.ts` reach the overlay through `lib/observers.ts` and
`convex/extensions.ts`. The hook is looked up when it is called, not when the modules load, so
an overlay importing from `convex/lib` closes no cycle, as long as it reads nothing from those
modules at its own top level.

## Sign-in

`beforeSignInCode` is the seam's one point of contact with sign-in, and it is enough for the
e-mail code method: a code nobody received cannot be used, so nothing needs to happen at
verification. (The code does exist: Better Auth stores it in its `verification` table before
asking for it to be sent, and the request counted against the rate limits. Nobody knows it, and
it expires like any other.)

**A refusal is silent, in content and in time.** The hook decides on an address typed by anyone,
so neither the answer nor its speed may depend on the decision, or the login page becomes a
way to sort addresses. Two facts make it so:

- Better Auth answers `send-verification-otp` the same way whatever `sendVerificationOTP` does,
  but it **awaits** it: `plugins/email-otp/routes.mjs` calls
  `ctx.context.runInBackgroundOrAwait(opts.sendVerificationOTP(…))`, and
  `context/create-context.mjs` only runs it in the background when
  `advanced.backgroundTasks.handler` is set; otherwise it awaits and swallows what is thrown
  (better-auth 1.6.15). That handler is not set here, and should not be: a promise left running
  after a Convex HTTP action answered has no guarantee of finishing. So a decision taken in
  `sendVerificationOTP` would show in the response time.
- So `sendVerificationOTP` does one thing for every address: it hands the delivery to the
  scheduler (`deliverSignInCode`) and returns. The rate limit, the toggle, this hook, the dev
  whitelist and the provider call all run in that scheduled action, out of the request's path,
  and a scheduled function is durable where an un-awaited promise is not. The code travels in
  the scheduled function's arguments, which hold nothing the `verification` table does not.

A refusal therefore cannot reach the login page as an error. Say who may use the form with
`loginMethods` (Frontend), not with an error.

**A refusal is a `ConvexError`; anything else is a bug.** For the requester both are the same
silence. For the operator they are not: a refusal is a warning carrying its code (only a `code`
that looks like one is written, `unknown` otherwise, so an overlay cannot leak the address
there by accident); a `TypeError`, a query that no longer exists or any other throw means
nobody can sign in by code, so it is logged as an error (« seam bug, code not sent », the
error's name and message, the address taken out if the message quotes it) and leaves a durable
trace where an admin looks: one `auditLogs` row an hour at most, `appConfig` /
`extensions:beforeSignInCode`, like a failing `afterChange`. Throw a `ConvexError` to refuse,
never a plain `Error`.

The hook is given the address and the type, **nothing else**: not the page's query string, not
the requester's IP. The way in an overlay opens with `loginMethods` is presentation only; the
decision here can only rest on who the address belongs to (a role, a domain, an invitation).

What goes through the hook: every sign-in code, which includes the **first sign-in of an invited
person** (the invitation e-mail carries no code, it sends them to the login page where they ask
for one). An overlay that refuses codes for some people also keeps their invitees from coming
in that way; they sign in with a provider instead. `type` says why the code goes out, in Better
Auth's terms; only `'sign-in'` is wired, since the CRM has neither passwords nor address
verification, and the field is there so the contract does not have to change when that does.
Providers (social, SSO) are not asked: an overlay that wants people to use them only has to
refuse the code.

The hook runs in an action: no `ctx.db`, use `ctx.runQuery` on a function of the overlay's own.

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
  data) into a user message, null for codes it does not own. The login page asks it first for
  every sign-in error (`describeSignInError`), with the error's message then its code: a
  refusal thrown by `beforeInvitation` at acceptance surfaces there, and so do Better Auth's own
  messages in clear (« Invalid email »). **Match codes exactly**, never with `includes`.
- `loginMethods(config, search)`: optional; the login page asks before showing the e-mail code
  form. `config` is the public config, the overlay's `publicConfig` fields included; `search` is
  the page's query string, so the overlay can keep a way in of its choosing. `{ emailCode: false }`
  hides the form (the providers stay); `{ emailCodeNotice }` puts a sentence under it. It can only
  narrow: a method the deployment disabled stays disabled. While the public config loads, a page
  whose overlay defines `loginMethods` shows no form (none that could vanish a moment later).
  Hiding the form is presentation, the enforcement is `beforeSignInCode`. The page's rendering
  is not covered by tests (there is no frontend harness); its decisions are two pure functions,
  which are.

## Tests

`setExtensionsForTests(overrides)` in `convex/extensions.ts` swaps hooks for the duration of a
`bun:test` case, since the functions run in-process; pass `null` to restore the defaults. See
`tests/backend/extensions.test.ts`, and `tests/backend/signInSeam.test.ts` for the sign-in hook
(through Better Auth's own route) and the login page's two functions.
