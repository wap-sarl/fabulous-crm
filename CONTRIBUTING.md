# Contributing

Issues, pull requests, commits and code comments are written in English. The README stays
in French because it is the self-hosting reference for the French-speaking customers.

## Setup

The recommended environment is the `wap-crm-dev` Docker container described in the README
(section « Développement »). The package manager is **bun**; never use npm or npx. Run the
Convex CLI through `bunx convex …`.

## Workflow

1. Pick or open an issue. Branch from `main` with `gh issue develop <number> --checkout --base main`.
2. Open the pull request with **one squashed commit**. Review fixes go in as separate
   commits; do not squash, amend or force-push once the PR is open.
3. Before **every** commit, push or pull request, run on the exact tree you are about to
   commit:

   ```sh
   bun run format && bun run lint && bun run typecheck && bun test
   ```

   CI runs the same checks plus a build and a secret scan.

## Conventions

- Imports use the `@crm/*` alias for `./src/*`.
- Comments are one line each; explain why, not what.
- `convex/_generated` is committed: run `bun run codegen` after changing Convex functions.
- The Convex schema validates strictly: a new audit `entityType` must be added to
  `convex/_lib/validators/auditLogs.ts`.
- Runtime configuration goes through `window.__ENV__` (`public/env.js`), never build-time only.
- Form and field validation uses zod schemas; backend validators use Convex `v.*`.
- Tests are `bun:test` suites under `tests/backend/` using `convex-test`; every behaviour
  change comes with its test.
