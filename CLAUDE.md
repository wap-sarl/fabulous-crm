# Instructions pour Claude — WAP CRM

Lire `README.md` : structure du projet, workflow dev (conteneur `wap-crm-dev`),
scripts, seeds, et le tableau complet des variables d'environnement (frontend
`.env.local` + environnement du déploiement Convex).

Points clés :
- Package manager : **bun** (jamais npm/npx). Convex CLI via `bunx convex …`.
- Alias d'import : `@crm/*` → `./src/*`. Ne pas réintroduire de specifiers `@est-sante/*`.
- `convex/_generated` est commité ; le régénérer avec `bun run codegen` après
  modification des fonctions Convex.
- Le schéma Convex valide strictement (`schemaValidation` actif) : toute
  nouvelle valeur d'`entityType` d'audit doit être ajoutée à
  `convex/_lib/validators/auditLogs.ts`.
- Config runtime prod via `window.__ENV__` (`public/env.js` généré par
  l'entrypoint Docker) — ne pas remplacer par du build-time only.
