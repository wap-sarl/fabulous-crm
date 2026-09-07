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
| `beforeLeadCreate(ctx, { count, source })` | lead creation (`crm`), CSV import (`import`, `count` = rows, an upper bound) and the public API (`api`) | throw to refuse |
| `beforeSend(ctx, { channel, count, source })` | the last preparation page of a campaign (`count` = recipients with a contact) and each workflow send step (`count: 1`) | `false` marks the campaign `failed` or logs the step as `skipped` |
| `beforeWorkflowRun(ctx, workflow)` | every enrollment | `false` skips the enrollment; the host write succeeds |
| `beforeApiRequest(ctx, key, method)` | after API authentication and rate limits | a `{ status, code, message, details? }` answers instead of the route |
| `registerHttpRoutes(http)` | `convex/http.ts`, before the `/api/v1/` routes | register extra routes |

Hooks receive the same `ctx` as the caller and run inside its transaction: a thrown error
rolls the caller back. Keep them cheap; they run on every call.

## Frontend

`src/extensions.tsx` exports `extensions: FrontendExtensions`:

- `routes`: mounted inside the authenticated shell (`DashboardShell`), after the built-in pages.
- `navItems`: appended to the sidebar for every user.
- `ShellGuard`: a component wrapping the shell; render `children` to show the app, or
  something else (a billing page, a maintenance notice) to replace it.

## Tests

`setExtensionsForTests(overrides)` in `convex/extensions.ts` swaps hooks for the duration of a
`bun:test` case, since the functions run in-process; pass `null` to restore the defaults. See
`tests/backend/extensions.test.ts`.
