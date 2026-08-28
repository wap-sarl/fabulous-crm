# WAP CRM

CRM autonome de gestion de leads et de campagnes email, extrait du monorepo
est-santé (2026-07) pour être réutilisable par plusieurs projets. Projet plat :
**bun + Vite + React 19 + Convex**, sans Nx ni workspaces.

## Fonctionnalités

- **Leads** : création, édition, suppression (unitaire et en masse), filtres,
  pagination, import CSV avec upsert (clé de matching : email), assignation à
  un employé.
- **Entreprises** : organisations rattachées aux leads (`companies`,
  `leads.companyId`). Rattachement : par numéro d'immatriculation, par
  numéro de TVA (données d'entreprise explicites), puis par domaine de
  l'e-mail (`x@acme.fr` → entreprise **existante** de domaine `acme.fr` ; un
  lead n'a pas forcément d'entreprise, aucune n'est créée à partir d'un
  e-mail ; les messageries grand public sont exclues). Dans le formulaire de
  lead, la correspondance par domaine est **proposée** à l'enregistrement
  (« Rattacher ce lead à cette entreprise ? » Oui / Non) et jamais appliquée
  sans réponse ; seul l'import CSV rattache par domaine automatiquement. Le
  numéro d'immatriculation dépend du pays de l'entreprise
  (SIRET vérifié dans la base Sirene pour la France, texte libre ailleurs) via
  un registre d'inputs par pays extensible (`src/lib/countryInputs`).
- **Adresses par pays** : l'adresse (objet imbriqué partagé par leads,
  entreprises et employés) est pilotée par son `country` (code ISO) : ordre des
  champs, libellés (État / province / préfecture, code ZIP…), champs requis,
  format du code postal et liste des régions viennent des métadonnées
  libaddressinput de Google (`convex/_lib/validators/addressFormats.generated.ts`,
  régénérées par `bun run scripts/generate-address-formats.ts`). Même saisie
  pour tous les pays : recherche d'adresse en haut (BAN pour la France, Photon
  / OpenStreetMap ou Google Places ailleurs, selon le pays), champs imbriqués
  du pays en dessous. Le **numéro de TVA** des entreprises est
  validé par pays (format + clé via `jsvat`) et vérifié en direct dans VIES
  pour l'UE.
- **Transactions et pipelines** : transactions (montant, devise, date de
  clôture, propriétaire, lead, campagne d'origine) dans des
  pipelines configurables (*Paramètres → Pipelines* : stades ordonnés,
  stades gagné/perdu, plusieurs pipelines). Vue Kanban
  (glisser-déposer) et vue liste ; historique des stades (`dealStageHistory`) ;
  compteurs et montants par stade via agrégats. Déclencheurs de workflow
  `deal_created` / `deal_stage_changed` / `deal_won` / `deal_lost` et étapes
  « Créer une transaction » / « Changer le stade d'une transaction ». Une transaction
  gagnée fait passer son lead au statut « Client ».
- **Tâches et activités** : appels, réunions, tâches, e-mails, notes
  (`activities`) rattachés à un lead, une entreprise ou une transaction, avec
  échéance, propriétaire et résultat. Vue « Mes tâches » par période (en
  retard / aujourd'hui / cette semaine / plus tard / sans date, compteurs par
  agrégat), compte-rendu rapide d'un appel depuis les fiches (avec rappel
  optionnel), étape de workflow « Créer une tâche ». Les rappels à l'échéance
  arrivent avec le système de notifications (lot 5) ; `dueAt` en est le point
  d'accroche.
- **Équipes, rôles et accès** : chaque lead, entreprise et transaction a
  zéro, un ou plusieurs propriétaires (`ownerIds`, le premier est le
  propriétaire principal, espace de noms des agrégats par propriétaire). Les
  collaborateurs peuvent appartenir à plusieurs équipes (`teams`, *Paramètres
  → Équipe*) ; une tâche peut être confiée à une personne et/ou à une équipe
  (toute l'équipe la voit ; sans l'un ni l'autre, tout le monde). Les rôles
  sont des données (`roles`, *Paramètres → Rôles et accès*) : une grille
  rôles × modules dont chaque case vaut `none` / `own` / `team` / `all`, plus
  un interrupteur « Paramètres ». Valeurs par défaut : `admin` tout, `manager`
  son équipe, `member` ses fiches — « Mes fiches » et « Mon équipe » incluent
  les fiches sans propriétaire (le pool). Rôles personnalisés (créer, renommer,
  supprimer avec réaffectation) ; `admin` est verrouillé et un rôle ne peut pas
  se retirer « Paramètres ». Le périmètre est appliqué dans les wrappers
  `_lib/auth.ts` (row-level security `convex-helpers` sur toutes les tables de
  chaque module, enfants compris — lecture et écriture), jamais par requête ;
  les compteurs par agrégat se restreignent via `ctx.visibility`, les
  destinataires d'une campagne sont résolus dans le périmètre de son auteur.
- **Fichiers joints** : devis, scans, contrats… déposés (glisser-déposer) sur
  une fiche lead, entreprise ou transaction (`attachments`), rangés dans une
  arborescence de dossiers par fiche, aperçu des images et PDF, téléchargement,
  suppression définitive (ligne + blob). Taille maximale configurable dans
  *Paramètres → Fichiers* (`appConfig.attachments.maxSizeBytes`), appliquée
  côté serveur à la demande d'URL d'envoi puis sur le blob stocké. Les octets
  vivent dans Convex Storage derrière l'interface `FileStore`
  (`convex/lib/fileStorage.ts`) ; chaque ligne porte déjà la clé
  `type/identifiant/dossier/nom` d'un stockage objet, pour migrer vers S3 en
  copiant les blobs clé par clé.
- **Doublons** : détection des leads en double par téléphone normalisé
  (E.164), e-mail, nom + code postal et distance de Levenshtein sur le nom
  (clés `dedupe` estampillées par le trigger des leads, index dédiés). Analyse
  par lots planifiés (`duplicateScans`, `leadDuplicates`), écran « Doublons
  potentiels » avec comparaison côte à côte et fusion champ par champ : les
  notes, activités, transactions, envois, workflows et listes du doublon sont
  rattachés à la fiche conservée (mutation sous triggers, agrégats et recherche
  exacts), entrée d'audit `merge`. L'import CSV prévisualise les correspondances
  hors e-mail et peut mettre à jour la fiche existante.
- **Historique unifié** : la fiche lead affiche notes, activités, envois et
  événements de campagne, inscriptions aux workflows, changements de statut,
  transactions et modifications de la fiche dans un seul fil chronologique,
  filtrable par type (`features/timeline`). Chaque source est paginée sur son
  propre index et fusionnée par curseur (`lib/timeline.ts`) : charger la suite
  ne relit jamais une table entière.
- **Propriétés personnalisées** : champs définis par un admin (9 types :
  texte, nombre, e-mail, liste, choix unique/multiple, date, boolean, RPPS)
  sur les leads, entreprises, transactions et activités (`propertyDefinitions`,
  `entityType`), valeurs stockées dans `customProperties` de chaque fiche.
  Validation partagée front/back (`_lib/validators/properties.ts`,
  `lib/properties.ts`), colonnes optionnelles dans les listes, formulaires et
  filtres avancés génériques par entité (`_lib/validators/filters.ts`,
  `features/filters`). Chaque type est décrit une fois de chaque côté par un
  **registre** : `convex/_lib/validators/propertyTypes.ts` (forme stockée,
  règles de validation, rendu des paramètres de campagne — le validateur
  `propertyTypeValidator` et la liste des types à options en dérivent) et
  `src/features/properties/lib/propertyTypes.tsx` (libellé, composant de
  saisie, affichage, type de filtre, coercition CSV). Ajouter un type = une clé
  dans `PROPERTY_TYPE_KEYS` et un descripteur dans chaque registre ; les
  `Record<PropertyType, …>` font échouer `typecheck` s'il en manque un, et
  `tests/backend/propertyTypes.test.ts` vérifie la cohérence. Les propriétés calculées (score, dernière activité…)
  sont prévues via le drapeau `computed`.
- **Statuts** : position du lead dans le parcours marketing → commercial
  (`lifecycleStage` : abonné → lead → MQL → SQL → opportunité → client →
  ambassadeur), configurable dans *Paramètres → Statuts* (statuts,
  statut par défaut, interdiction du retour en arrière). Chaque changement est
  journalisé dans `lifecycleStageHistory` ; les workflows disposent d'une
  étape « Changer le statut ». Le placeholder `{{ params.status }}` des
  campagnes renvoie le libellé du statut.
- **Campagnes** : création de campagnes email Brevo (template + destinataires
  filtrés), suivi des envois (`campaignSends`), statuts.
- **Consentement RGPD** : page publique `/consent/:token` permettant à un lead
  de modifier ou révoquer ses consentements marketing (email, téléphone,
  postal), sans authentification.
- **Auth** : magic link par email (Brevo) + code OTP, sessions stockées en base
  avec token en localStorage. Seuls les utilisateurs `employee` accèdent au CRM.

## Structure

```
convex/              Backend Convex (schéma, fonctions)
  _lib/              Wrappers d'auth (employeeQuery/Mutation…), validators
  auth/              Magic link, OTP, sessions
  features/crm/      Leads, campagnes, consentement
  features/users/    Liste des employés (sélecteur « assigné à »)
  lib/               Helpers serveur vendorés (Brevo, audit, crypto…)
  seed/              Bootstrap employé + backdoor de session dev
src/
  design-system/     Design system vendoré (copié du monorepo)
  widgets/           Auth, layouts, providers vendorés (tranche du monorepo)
  features/ pages/   Code applicatif CRM
  lib/               backend.ts (ré-exports Convex), shared.ts, types.ts
docker/              Caddyfile + entrypoint de l'image de production
```

Alias d'import : `@crm/*` → `./src/*` (déclaré dans `tsconfig.json` et
`vite.config.mts`).

## Développement

### Dans le conteneur dev (recommandé)

```bash
docker build -f Dockerfile.local --build-arg UID=$(id -u) --build-arg GID=$(id -g) -t wap-crm:dev .
docker run -d --name wap-crm-dev --network proxy -v "$PWD":/app wap-crm:dev
docker exec -it wap-crm-dev bash
bun install
bun run dev            # convex dev + vite (nécessite `bunx convex login` une fois)
bun run dev:frontend   # vite seul (les fonctions déjà déployées suffisent)
```

Aucun port n'est publié : le conteneur rejoint le réseau `proxy` et le reverse
proxy de l'hôte route vers `wap-crm-dev:4202` (vite écoute sur `0.0.0.0:4202`).
Sans reverse proxy, remplacer `--network proxy` par `-p 4202:4202` et ouvrir
<http://localhost:4202>. L'entrypoint du conteneur est inerte (`tail -f`) :
relancer `docker exec -d wap-crm-dev bun run dev:frontend` après un redémarrage.

### Directement sur la machine

```bash
bun install
bun run dev
```

### Scripts

| Script | Effet |
|---|---|
| `bun run dev` | `convex dev` + `vite` en parallèle |
| `bun run dev:frontend` / `dev:backend` | l'un des deux seulement |
| `bun run build` | `tsc --noEmit` + `vite build` → `dist/` |
| `bun run typecheck` | tsconfig app + tsconfig convex |
| `bun run codegen` | régénère `convex/_generated` (commité) |
| `bun run test` | lance les suites `bun:test` |
| `bun run test:watch` | idem, en mode watch |

### Bootstrap & connexion locale

Un déploiement neuf n'a aucun utilisateur : créer un premier employé (seuls
les utilisateurs `employee` accèdent au CRM) :

```bash
bunx convex run seed/devEmployee:createDevEmployee '{"email":"you@example.com","firstName":"You","lastName":"Example"}'
```

Sans clé Brevo, utiliser la backdoor de session :

```bash
bunx convex run seed/devSession:createDevSession '{"email":"you@example.com"}'
# puis dans la console du navigateur :
localStorage.setItem('wap-crm-session-token', '<token retourné>')
```

## Variables d'environnement

### Frontend — `.env.local` (voir `.env.local.example`)

| Variable | Requis | Rôle |
|---|---|---|
| `CONVEX_DEPLOYMENT` | CLI | Déploiement ciblé par `convex dev` / `convex run` (écrit automatiquement) |
| `VITE_CONVEX_URL` | **oui** | URL du déploiement Convex ; `main.tsx` lève une erreur si absente |
| `VITE_CONVEX_SITE_URL` | non | Origine `.convex.site` servant les routes Better Auth (`/api/auth/*`), utilisée comme `baseURL` du client d'auth. Si absente, dérivée de `VITE_CONVEX_URL` (`.convex.cloud` → `.convex.site`) |
| `VITE_GOOGLE_MAPS_API_KEY` | non | Autocomplétion d'adresse Google Places pour les pays **hors France** (restreinte au pays sélectionné). Sans clé, l'app utilise Photon (OpenStreetMap, sans clé) ; la France passe toujours par l'API **BAN** gouvernementale. Voir `src/lib/countryInputs/address.tsx` (`registerAddressProvider`). |

En production, les `VITE_*` sont injectées **au démarrage du conteneur** :
l'entrypoint génère `/srv/env.js` (`window.__ENV__`) à partir des variables
d'environnement du conteneur — pas de rebuild par environnement.

### Backend — environnement du déploiement Convex (`bunx convex env set …`)

| Variable | Requis | Rôle |
|---|---|---|
| `SETUP_TOKEN` | **oui** au premier démarrage | Jeton exigé par l'assistant de configuration initiale (`/setup`). Sans lui, l'assistant refuse de démarrer. Générer avec `bunx convex env set SETUP_TOKEN $(openssl rand -hex 32)`. Voir [Configuration initiale](#configuration-initiale). |
| `SITE_URL` | **oui** (auth) | Origine(s) de la SPA. Sert à Better Auth (`trustedOrigins` + transport de session `crossDomain`, cible des redirections après connexion) **et** de base aux liens email/consentement (en secours de `appConfig.appUrl`). Plusieurs origines séparées par des virgules ; ex. `https://crm.example.com`. Sans elle, les connexions social/email sont refusées. |
| `BETTER_AUTH_SECRET` | **oui** en prod | Secret de signature des sessions Better Auth. Générer avec `bunx convex env set BETTER_AUTH_SECRET $(openssl rand -hex 32)`. Absent = secret éphémère (sessions invalidées à chaque déploiement). |
| `BREVO_API_KEY` | **oui** pour les emails et SMS | Envoi des liens de connexion (email OTP, plugin Better Auth) et des campagnes email/SMS (même clé pour l'API SMS transactionnel) |
| `FHIR_API_KEY` | non (requis pour la vérif. RPPS) | Clé de l'API FHIR Annuaire Santé (`gateway.api.esante.gouv.fr`), envoyée en en-tête `ESANTE-API-KEY`. Utilisée par l'action `features/practitionerInfo/actions.verifyRpps` pour vérifier un numéro RPPS (propriété personnalisée de type `rpps`). Sans elle, la vérification renvoie une erreur mais la saisie reste possible. |
| `CRM_APP_URL` | ~~déprécié~~ | Ancien nom de l'origine SPA — repli si `SITE_URL` est absente. Utiliser `SITE_URL`. |
| `DEV_WHITELIST_EMAILS` | dev | Liste blanche emails (séparée par virgules) : tout envoi email Brevo vers un destinataire hors liste est bloqué ; vide = tout passe (comportement prod) |
| `DEV_WHITELIST_PHONES` | dev | Liste blanche numéros (séparée par virgules, format E.164 ex. `+33612345678`) : tout envoi SMS Brevo vers un numéro hors liste est bloqué ; vide = tout passe (comportement prod) |
| `EMAIL_SENDER_NAME` | prod | Nom d'expéditeur des emails (défaut `CRM`) — secours si non défini dans la config runtime |
| `EMAIL_SENDER_EMAIL` | prod | Adresse d'expéditeur des emails (défaut `noreply@example.com`) — le domaine doit être un expéditeur Brevo vérifié ; secours si non défini dans la config runtime |
| `BREVO_SMS_SENDER` | **oui** pour les SMS | Nom d'expéditeur affiché sur les SMS (ID alphanumérique Brevo, ≤ 11 caractères ; défaut `CRM`) |
| `BREVO_WEBHOOK_SECRET` | non (requis pour les webhooks) | Secret des webhooks Brevo au niveau compte (`/webhooks/brevo/email` et `/webhooks/brevo/sms`). Envoyé dans l'en-tête `x-webhook-secret` fixé à l'enregistrement (`registerBrevoEmailWebhook` / `registerBrevoSmsWebhook`) — jamais dans l'URL. Générer avec `bunx convex env set BREVO_WEBHOOK_SECRET $(openssl rand -hex 32)`. Absent = webhooks désactivés. |
| `BREVO_SMS_WEBHOOK_SECRET` | non (recommandé pour le STOP SMS) | Secret **dédié** du webhook SMS par message (`webUrl` posé sur chaque envoi) : les webhooks par message de Brevo ne peuvent pas envoyer d'en-tête, ce secret voyage donc dans l'URL — d'où une valeur distincte, révocable sans toucher au secret de compte. Repli sur `BREVO_WEBHOOK_SECRET` si absente. Générer avec `bunx convex env set BREVO_SMS_WEBHOOK_SECRET $(openssl rand -hex 32)`. |

> La plupart des réglages ci-dessus (URL, expéditeur) et les identifiants des
> fournisseurs sociaux (Google…) sont stockés dans la table Convex singleton
> `appConfig`, renseignée par l'assistant de configuration initiale. Les variables
> d'environnement restantes servent de secours (`EMAIL_SENDER_*`)
> ou de secret/config déploiement (`SETUP_TOKEN`, `BREVO_API_KEY`, `SITE_URL`,
> `BETTER_AUTH_SECRET`). `CONVEX_SITE_URL` est injectée automatiquement par Convex
> et sert d'origine aux routes/callbacks Better Auth — rien à définir.

### Rotation des secrets webhook Brevo

Les deux secrets se tournent indépendamment, sans interruption de service :

1. **Secret de compte (`BREVO_WEBHOOK_SECRET`)** — en-têtes des webhooks
   e-mail et SMS entrants :
   ```bash
   bunx convex env set BREVO_WEBHOOK_SECRET $(openssl rand -hex 32) --prod
   bunx convex run features/crm/actions:registerBrevoEmailWebhook --prod
   bunx convex run features/crm/actions:registerBrevoSmsWebhook --prod
   ```
   L'enregistrement met à jour l'en-tête `x-webhook-secret` chez Brevo ; les
   routes comparent en temps constant et acceptent immédiatement la nouvelle
   valeur.
2. **Secret SMS par message (`BREVO_SMS_WEBHOOK_SECRET`)** — présent dans le
   `webUrl` de chaque SMS envoyé :
   ```bash
   bunx convex env set BREVO_SMS_WEBHOOK_SECRET $(openssl rand -hex 32) --prod
   ```
   Prend effet pour les envois suivants. Attention : les événements des SMS déjà
   partis porteront encore l'ancien `webUrl` — tourner ce secret hors d'une
   campagne en cours, ou accepter la perte des événements tardifs (STOP compris)
   des messages déjà envoyés.

## Configuration initiale

Au premier démarrage (aucune configuration, aucun utilisateur), toute visite est
redirigée vers l'assistant `/setup`. Il configure les bases du CRM (organisation,
URL, expéditeur), les méthodes de connexion, puis crée le premier administrateur
(le propriétaire). Better Auth étant l'autorité de session, l'assistant ne connecte
plus l'administrateur directement : il est redirigé vers `/login`, et sa première
connexion Better Auth lie son compte (le portail d'invitation l'autorise en tant
qu'employé existant).

1. Définir le jeton d'installation sur le déploiement Convex :
   `bunx convex env set SETUP_TOKEN $(openssl rand -hex 32)`.
2. Ouvrir `/setup`, saisir ce jeton, remplir les étapes, terminer. L'assistant se
   verrouille ensuite (une nouvelle visite de `/setup` redirige vers `/login`).

La configuration est stockée dans la table singleton `appConfig` ; les secrets
(client secrets sociaux et SSO) ne sont jamais renvoyés au navigateur.

### SSO / OpenID Connect

Les fournisseurs SSO personnalisés sont gérés par le plugin *generic-oauth* de
Better Auth, **exactement comme les fournisseurs sociaux** : ils se configurent
dans l'assistant d'installation (et les réglages), stockés en base dans
`appConfig.auth.ssoProviders`. Chaque fournisseur est une entrée :
`providerId` (slug stable, utilisé dans l'URL de rappel), `label`, `issuerUrl`,
`clientId`, `clientSecret`, `scopes`, `enabled`. L'émetteur doit exposer un
document de découverte OIDC (`/.well-known/openid-configuration`) et émettre des
`id_token` standard. L'URL de rappel à déclarer dans la console du fournisseur est
`${CONVEX_SITE_URL}/api/auth/oauth2/callback/<providerId>` (affichée et copiable
dans l'assistant).

L'accès reste régi par le modèle sur invitation : à la première connexion, un
e-mail invité provisionne l'employé ; un e-mail non invité est refusé
(`not_invited`) — le même filtre que pour les fournisseurs sociaux et le lien
magique. Il n'y a donc ni `allowedDomains` ni `autoProvision` propres au SSO.

## Production

Le backend se déploie séparément : `bunx convex deploy` (+ `convex env set`
sur le déploiement de prod). Le frontend est une image Docker autonome :

```bash
docker build -t wap-crm .
docker run -d -p 8099:80 -e VITE_CONVEX_URL=https://<deployment>.convex.cloud wap-crm
```

Image multi-stage : build bun (tsc + vite) → `caddy:2-alpine` servant `dist/`
(cache immutable sur `/assets`, no-cache sur le HTML et `env.js`, fallback SPA).

### Déploiement local via Docker (build + run)

Procédure complète pour lancer l'image en local et arriver jusqu'à l'assistant
`/setup`.

1. **Renseigner l'environnement du déploiement Convex** (côté serveur — **pas**
   l'environnement du conteneur), `SETUP_TOKEN` en tête car exigé au premier
   démarrage :
   ```bash
   bunx convex env set SETUP_TOKEN $(openssl rand -hex 32)         # requis au 1er démarrage
   bunx convex env set SITE_URL https://crm.example.com            # requis (auth) : origine SPA + base des liens email/consentement
   bunx convex env set BETTER_AUTH_SECRET $(openssl rand -hex 32)  # requis en prod : signature des sessions
   bunx convex env set BREVO_API_KEY <clé>                         # requis pour les emails et SMS
   bunx convex env set EMAIL_SENDER_EMAIL noreply@example.com      # expéditeur Brevo vérifié
   bunx convex env set EMAIL_SENDER_NAME "CRM"
   bunx convex env set BREVO_SMS_SENDER "CRM"                      # requis pour les SMS (≤ 11 car. alphanum.)
   bunx convex env set BREVO_WEBHOOK_SECRET $(openssl rand -hex 32) # optionnel : désinscription SMS via réponse STOP
   bunx convex env set FHIR_API_KEY <clé>                          # optionnel : vérif. RPPS (Annuaire Santé)
   ```
   Liste complète : [Variables d'environnement — Backend](#backend--environnement-du-déploiement-convex-bunx-convex-env-set-).

2. **Construire l'image dev** (`Dockerfile.local`, base `oven/bun` — c'est elle qui
   embarque `bun` ; l'image de production `caddy:2-alpine` n'a pas `bun`) :
   ```bash
   docker build -f Dockerfile.local --build-arg UID=$(id -u) --build-arg GID=$(id -g) -t wap-crm:dev .
   ```

3. **Lancer le conteneur** (nom `wap-crm-dev`, réseau `proxy`, dossier projet monté
   en volume) :
   ```bash
   docker rm -f wap-crm-dev || true && \
   docker run -d --name wap-crm-dev --network proxy -v "$PWD":/app wap-crm:dev
   ```
   Aucun port publié : le reverse proxy de l'hôte route vers `wap-crm-dev:4202`.

4. **Entrer dans le conteneur, installer, démarrer** (l'entrypoint est inerte,
   `tail -f`) :
   ```bash
   docker exec -it wap-crm-dev bash
   bun install
   bun run dev            # convex dev + vite (`bunx convex login` une fois)
   ```
   Les `VITE_*` (dont `VITE_CONVEX_URL`) sont lues depuis `.env.local` monté dans
   le conteneur — pas d'injection `-e`, qui ne sert qu'à l'image de production.

5. **Ouvrir `/setup`**, saisir le `SETUP_TOKEN`, terminer l'assistant : le premier
   administrateur est créé et connecté, puis l'assistant se verrouille.

> **Deux niveaux d'environnement distincts.** Le conteneur dev lit les `VITE_*`
> depuis `.env.local` (monté en volume). `SETUP_TOKEN` et les autres secrets
> (`BREVO_API_KEY`, expéditeur…) vivent sur le **déploiement Convex**
> (`bunx convex env set`) — les placer dans l'environnement du conteneur n'a
> **aucun effet**, car l'assistant vérifie le jeton côté Convex.

### Caddy & reverse proxy

Le Caddy **embarqué dans l'image** (`docker/Caddyfile`) n'est pas un reverse
proxy : c'est un simple serveur statique sur `:80` (fallback SPA vers
`index.html`, `Cache-Control: immutable` sur `/assets/*`, no-cache sur le HTML
et `env.js`, en-têtes de sécurité). Rien n'est proxifié car le navigateur parle
directement au déploiement Convex (`VITE_CONVEX_URL`) — aucun trafic API ne
transite par le conteneur.

Pour exposer le conteneur derrière le reverse proxy de l'hôte (TLS, nom de
domaine), il suffit de pointer vers le port publié (`8099` dans l'exemple
ci-dessus). Avec Caddy sur l'hôte :

```caddyfile
crm.example.com {
	reverse_proxy 127.0.0.1:8099
}
```

Aucune directive particulière n'est nécessaire : pas de WebSocket ni de chemin
d'API côté conteneur (le WebSocket Convex va directement du navigateur vers
`*.convex.cloud`). Penser à aligner `SITE_URL` (env Convex) sur l'URL
publique pour que l'authentification, les liens de connexion et de consentement
soient corrects.

## Origine & divergence

Extrait du monorepo est-santé : seuls les modules Convex nécessaires ont été
forkés (leads/campagnes/consentement, auth magic link, liste des employés).
Les notions métier est-santé (thèmes, occupations, RPPS, crédits DPC/FIF PL,
seeds d'employés) ont ensuite été retirées pour rendre le CRM agnostique —
elles reviendront sous forme de « custom properties » génériques. Les types
utilisateur `student`/`trainer`, les branches d'auth e-learning/back-office et
le branding est-santé (logos d'email, textes, clés localStorage `est-sante-*`)
ont également été retirés : seul le type `employee` subsiste. Le design system
est copié intégralement ; `src/widgets` ne contient que la tranche auth/layout.

Note campagnes : le placeholder Brevo `{{ params.occupation }}` n'est plus
alimenté (rend vide) — retirer sa référence des templates Brevo existants.
