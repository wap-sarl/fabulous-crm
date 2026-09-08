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
| `beforeLeadCreate(ctx, { count, source })` | a lead becoming live: creation (`crm`), CSV import (`import`, `count` = rows, an upper bound covering creations and revivals) and the public API (`api`, creation and revival of a soft-deleted contact by upsert) | throw to refuse |
| `beforeSend(ctx, info)` | campaigns at four stages — `create` (`count: 1`, before any recipient is materialised), `preparing` (each 200-lead preparation page, `count` = recipients with a contact so far), `prepared` (last page, final count) and `resend` (retry of one send or resend of all, `count` = messages re-queued) — and each workflow send step (`count: 1`) | `false` marks the campaign `failed` at `preparing` / `prepared`, throws `send_refused` at `create` and `resend`, logs a workflow step as `skipped` |
| `beforeWorkflowRun(ctx, workflow)` | every enrollment | `false` skips the enrollment; the host write succeeds |
| `beforeApiRequest(ctx, key, method)` | after API authentication and rate limits | a `{ status, code, message, details? }` answers instead of the route |
| `registerHttpRoutes(http)` | `convex/http.ts`, before the `/api/v1/` routes | register extra routes |

The recipient count of a campaign is not known at creation: resolving it means scanning
every lead, which is exactly why preparation runs in pages. `create` therefore only asks
whether at least one message may go out, and the running count is checked again on every
page, so a refused campaign writes at most one page of sends past the limit before it is
marked `failed`. Overlays that reserve quota should do it at `prepared`.

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

## Tests

`setExtensionsForTests(overrides)` in `convex/extensions.ts` swaps hooks for the duration of a
`bun:test` case, since the functions run in-process; pass `null` to restore the defaults. See
`tests/backend/extensions.test.ts`.
