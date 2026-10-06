# Fabulous CRM

CRM open source (Apache 2.0) pour petites entreprises : contacts, entreprises,
transactions, campagnes e-mail et SMS, workflows, formulaires, suivi web, API
publique. Projet plat : **bun + Vite + React 19 + Convex**, sans Nx ni
workspaces.

## Fonctionnalités

- **Leads** : création, édition, suppression (unitaire et en masse), filtres,
  pagination, import de fichiers (voir *Import avancé*), assignation à un
  employé.
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
  stades gagné/perdu, plusieurs pipelines). Les **transitions** autorisées
  entre stades forment un graphe (`pipelines.transitions`) : par défaut
  (liste absente) chaque stade mène au suivant et peut revenir au précédent,
  le dernier stade en cours ↔ gagné / perdu (`defaultTransitions`). La fiche
  d'un pipeline en montre un aperçu ; « Modifier » ouvre un éditeur plein
  écran (infos et stades à gauche, graphe `@xyflow/react` à droite) : un nœud
  par stade, une flèche par transition dans les deux sens, « × » sur une
  flèche pour l'interdire, glisser un stade sur un autre pour en ajouter une,
  « Tout autoriser » (graphe complet) et « Transitions linéaires » (retour au
  défaut) ; stades et flèches se déplacent à la souris et la disposition est
  enregistrée avec le pipeline (`pipelines.layout`), l'aperçu la reprend telle
  quelle ; les stades gagné/perdu sont des puits sauf flèches de
  réouverture. Un validateur pur (`analyzePipelineGraph`) tourne à chaque
  modification, côté éditeur et côté serveur : stade inaccessible et impasse
  (aucun chemin vers gagné/perdu) sont signalés en avertissement. Chaque
  déplacement passe par `moveDealToStage`, qui refuse une flèche absente
  (`deal_transition_forbidden`) ; le Kanban grise les colonnes inaccessibles
  pendant le glisser, le stepper désactive les stades interdits, et
  l'activation d'un workflow vérifie l'étape « Changer le stade » quand le
  déclencheur fixe le stade de départ. Vue Kanban
  (glisser-déposer) et vue liste ; historique des stades (`dealStageHistory`) ;
  compteurs et montants par stade via agrégats. Chaque stade peut porter des
  **étiquettes** (`stages[].tags`, clés stables ; sur « Perdue » ce sont les
  motifs de perte) : entrer dans un stade étiqueté propose les étiquettes (au
  moins une exigée si le stade l'impose, `tagsRequired`) et un commentaire, stockés sur la transaction (`stageTags`, `stageComment`) et dans
  la ligne d'historique, affichés sur la fiche, la carte Kanban et le fil du
  lead, filtrables (« Étiquettes de stade ») ; l'étape de workflow « Changer le
  stade » peut poser des étiquettes fixes. Déclencheurs de workflow
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
  arborescence de dossiers par fiche, aperçu des images et PDF, téléchargement.
  La suppression n'est pas définitive : le fichier passe dans la **corbeille** de la fiche
  (`deletedAt` / `deletedBy` / `purgeAt`, clé et blob inchangés), d'où il se
  restaure tel quel ou s'efface définitivement ; la suppression planifie sa
  propre purge (`ctx.scheduler.runAt(purgeAt)`, première rétention de
  l'application), qui n'efface ligne et blob que si le fichier est toujours
  dans la corbeille pour cette même date — une restauration puis une nouvelle
  suppression laissent l'ancienne tâche sans effet. Taille maximale et durée
  de rétention (30 jours par
  défaut, 1 à 365) configurables dans *Paramètres → Fichiers*
  (`appConfig.attachments.maxSizeBytes` / `retentionDays`), la taille étant
  appliquée côté serveur à la demande d'URL d'envoi puis sur le blob stocké. Les octets
  vivent dans Convex Storage derrière l'interface `FileStore`
  (`convex/lib/attachments/storage.ts`) ; chaque ligne porte déjà la clé
  `type/identifiant/dossier/nom` d'un stockage objet, pour migrer vers S3 en
  copiant les blobs clé par clé.
- **Conservation des données** : une purge nocturne (`convex/crons.ts`, 03:30 UTC,
  `features/retention`) efface ce qui dépasse les durées configurées dans
  *Paramètres → Conservation* (`appConfig.retention`) : les fiches supprimées
  (leads, entreprises, transactions, activités, formulaires ; 30 jours par défaut, 1 à 365)
  avec tout ce qui s'y rattache (notes, envois et événements de campagne, liens
  suivis, enrôlements et étapes de workflow, historique de statut, soumissions
  de formulaires, appartenances aux listes, paires de doublons, fichiers joints
  et leurs blobs ; une transaction
  ou une activité encore vivante perd seulement son lien), les événements de
  campagne, le journal des étapes de workflow et les liens suivis des campagnes
  terminées (365 jours par défaut, 30 à 3650), le journal d'audit (730 jours par
  défaut, 90 à 3650), ainsi que les invitations expirées et les clés
  d'idempotence de l'API périmées. La purge travaille par lots bornés (un budget de 2 000 écritures par lot, 20
  fiches, 500 lignes par table, 200 lignes rattachées par fiche et par lot,
  chaque requête lue directement dans une plage d'index) et s'enchaîne jusqu'à
  épuisement, la politique et l'instant de référence étant figés au premier lot ; une fiche aux centaines de lignes rattachées
  est vidée sur plusieurs lots avant de disparaître. Chaque exécution laisse une
  ligne d'audit (`retention` / `purge`) avec ses compteurs, affichée sur la page,
  et relance le recalcul complet des listes dynamiques par sécurité. Une
  extension peut différer la purge (`beforeScheduledWork`, `retention_purge`).
- **Formulaires de capture** (*Paramètres → Formulaires*) : formulaires publics
  composés de champs standard ou de propriétés personnalisées, à intégrer par
  un script (`GET /forms/<id>/embed.js`, l'élément cible par `data-target`,
  indispensable avec un gestionnaire de balises) ou en iframe
  (`GET /forms/<id>`, servie avec une CSP). Chaque champ a une clé publique
  stable (slug de son libellé) ; les valeurs soumises sont validées côté
  serveur avec les validateurs des propriétés (téléphone compris) et tronquées.
  **Ce qu'une soumission peut écrire**, l'adresse n'étant la preuve de rien :
  un e-mail inconnu (ou absent) crée un contact avec le consentement e-mail
  coché (**simple opt-in** : la case cochée vaut consentement, sur ce contact
  seulement) ; un contact vivant déjà connu n'est que complété (champs vides
  remplis, rien d'écrasé, aucun consentement posé, aucun déclencheur de
  propriété ou de consentement) et `form_submitted` est le seul déclencheur
  de workflow qu'un formulaire tire sur lui ; son compteur de soumissions ne
  bouge que si le navigateur est celui qui l'a créé (jeton de visiteur) ; un
  contact supprimé est un inconnu (un nouveau contact est créé). L'entreprise
  n'est rattachée que par le domaine de l'e-mail (jamais créée ni trouvée par
  le nom tapé, qui reste dans la soumission et dans le commentaire du nouveau
  contact). Profilage progressif : un jeton de visiteur (localStorage) fait
  sauter les champs déjà connus, seulement pour un formulaire avec e-mail et
  pour la même adresse. Chaque écriture est auditée (`source: form`).
  Anti-abus : honeypot (réponse factice, jeton compris), temps de remplissage
  minimum sur un horodatage signé, limites par IP, par formulaire et pour le
  déploiement (`lib/security/rateLimits.ts`), passage par le seam `beforeLeadCreate`
  (source `form`). L'adresse IP est **pseudonymisée** (HMAC sous une clé
  secrète, `FORM_IP_HASH_SALT` ou dérivée de `BETTER_AUTH_SECRET`) et suit la
  rétention du contact ; un formulaire supprimé suit celle des fiches
  supprimées.
- **Suivi web** (*Paramètres → Suivi web*) : un script servi par le
  déploiement (`GET /track.js`, à insérer sur le site), un cookie de visiteur
  `_wapv` posé sur le domaine du site après l'accord du visiteur (treize mois
  à compter de la première visite, propre à chaque hôte : `www.` et le domaine
  nu comptent pour deux navigateurs) et retiré si l'accord l'est. L'accord
  vient du bandeau fourni (libellé selon le mode, lien vers la politique de
  confidentialité, redemandé tous les six mois et au passage en nominatif) ou
  du gestionnaire de consentement du site (`window.wapTracking = { consent:
  true }`, `window.wapTrack.consent(ok)`). « Global Privacy Control » et « Do
  Not Track » sont respectés par le script comme par la route.
  Les balises de pages vues (`POST /track`, URL, titre, référent) ne sont
  acceptées que des **sites suivis** (`appConfig.tracking.allowedOrigins`,
  en-tête `Origin` et URL de chaque page), corps borné à 64 Ko, limitées par
  IP, par visiteur et pour tout le déploiement (600 pages vues par minute ;
  un dépassement est signalé, daté, sur la page des réglages).
  Tables `pageViews` (par visiteur et par contact) et `webVisitors`.
  Deux modes : **anonyme** (rien n'est rattaché à un contact) ou
  **nominatif** (un formulaire soumis depuis ce navigateur, y compris en
  iframe, ou un lien de campagne cliqué rattache ses pages vues au contact,
  celles d'avant comprises, par lots planifiés ; les suivantes lui arrivent
  directement et la fiche est mise à jour au plus une fois par minute). Le
  lien de campagne ne transmet jamais son jeton : la redirection vers un site
  suivi porte une valeur à usage unique (`wapl`), valable dix minutes, que le
  script retire de la barre d'adresse ; un e-mail transféré identifie donc
  celui qui clique comme le destinataire d'origine. Le mode nominatif demande
  une base légale, une information claire et une politique de confidentialité
  (obligatoire dans les réglages), à valider avant de l'activer. Une
  opposition au profilage détache aussitôt navigateurs et pages vues du
  contact ; quitter le mode nominatif détache tout (désactiver le suivi
  arrête la collecte sans rien détacher) ; une fusion de doublons
  les reporte sur la fiche conservée. Sur le contact : `pageViewCount`,
  `lastPageViewAt` et `visitedPages` (les 50 derniers chemins distincts),
  d'où le filtre « Pages visitées (chemin) » des listes dynamiques et des
  règles de scoring (« contient » un texte, « égal à » un chemin), et la
  fiche affiche les pages vues dans l'historique (filtre « Navigation »).
  Conservation propre (`appConfig.tracking.retentionDays`, 7 à 395 jours, 90
  par défaut) appliquée par la purge nocturne, qui recalcule aussi ces champs
  du contact d'après les pages vues restantes ; l'export RGPD contient les
  pages vues, l'effacement les emporte.
- **Doublons** : détection des leads en double par téléphone normalisé
  (E.164), e-mail, nom + code postal et distance de Levenshtein sur le nom
  (clés `dedupe` estampillées par le trigger des leads, index dédiés). Analyse
  par lots planifiés (`duplicateScans`, `leadDuplicates`), écran « Doublons
  potentiels » avec comparaison côte à côte et fusion champ par champ : les
  notes, activités, transactions, envois, workflows et listes du doublon sont
  rattachés à la fiche conservée (mutation sous triggers, agrégats et recherche
  exacts), entrée d'audit `merge`. La simulation d'un import signale les
  correspondances hors e-mail (doublons probables) et l'import peut mettre à
  jour la fiche existante.
- **Import avancé** : page « Importer » (`/import`, bouton *Importer* sur les
  leads, entreprises, transactions et tâches, et sur les listes) pour un fichier
  CSV (`,` `;` ou tabulation, BOM accepté) ou Excel `.xlsx` (première feuille,
  lue dans le navigateur par `src/features/imports/lib/readXlsx.ts`, dates
  reconnues par leur format). Les colonnes sont associées aux champs de
  l'entité (registres `src/features/imports/lib/*Fields.ts`, en-têtes usuels
  reconnus, propriétés personnalisées incluses) ; une *correspondance* peut
  être enregistrée par source (`importMappings`) et se réapplique d'elle-même
  aux fichiers qui ont les mêmes en-têtes. Le fichier devient un *job*
  (`importJobs`, lignes dans `importRows`) traité côté serveur par lots de 200
  (`features/imports`, `runBatch`) : d'abord une **simulation** qui dit, ligne
  par ligne, création, mise à jour, doublon probable ou erreur sans rien
  écrire, puis l'**import** qui applique exactement les mêmes règles
  (`plan`/`apply` d'un même importeur par entité, `features/imports/entities`).
  Règles de rapprochement : lead par e-mail (fiche vivante d'abord, sinon
  ravivée), sinon doublon probable par téléphone, nom + code postal ou nom
  proche, tranché par une politique à l'import (mettre à jour ou créer) ;
  entreprise par n° d'immatriculation, TVA, domaine puis nom exact ;
  transaction par contact (e-mail) + titre, pipeline et étape par leur nom ;
  activité par contact + titre + date, entreprise par nom. Un lot qui échoue
  (Convex ne réessaie pas) laisse le job *interrompu* avec l'erreur ; *Reprendre*
  repart de ce lot, les lots précédents étant validés et les lignes écrites
  supprimées au fur et à mesure, donc jamais réécrites. Rapport : compteurs,
  lignes en erreur avec leurs cellules d'origine et **export CSV des lignes en
  erreur** (colonnes source + ligne + erreur) ; les jobs terminés se suppriment
  depuis le rapport, et la purge de rétention les efface avec les événements
  (`eventDays`). La mutation `importLeads` reste disponible (mêmes règles,
  `lib/leads/import.ts`). Le consentement marketing n'est jamais importable.
- **Historique unifié** : la fiche lead affiche notes, activités, envois et
  événements de campagne, inscriptions aux workflows, changements de statut,
  transactions et modifications de la fiche dans un seul fil chronologique,
  filtrable par type (`features/timeline`). Chaque source est paginée sur son
  propre index et fusionnée par curseur (`lib/timeline/pagination.ts`) : charger la suite
  ne relit jamais une table entière.
- **Propriétés personnalisées** : champs définis par un admin (9 types :
  texte, nombre, e-mail, liste, choix unique/multiple, date, boolean, RPPS)
  sur les leads, entreprises, transactions et activités (`propertyDefinitions`,
  `entityType`), valeurs stockées dans `customProperties` de chaque fiche.
  Validation partagée front/back (`_lib/validators/properties.ts`,
  `lib/properties/definitions.ts`), colonnes optionnelles dans les listes, formulaires et
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
- **Droits des personnes (RGPD)** : sur la fiche d'un lead, carte « Droits de la
  personne » réservée aux détenteurs du droit *Paramètres* (`features/rgpd`),
  chaque action consignée dans le journal d'audit et dans la table
  `rgpdRequests` (type, demandeur, contact, date, résultat ; l'identifiant du
  contact y survit à son effacement, sans autre donnée). **Procédure** : la
  demande arrive par n'importe quel canal ; un administrateur l'exécute depuis
  la fiche **dans le mois** qui suit (article 12 du RGPD), et répond à la
  personne avec le résultat. *Droit d'accès* : « Exporter ses données »
  produit une archive JSON de tout ce que le CRM détient sur la personne
  (fiche, entreprise, notes, listes, historique de statut, transactions et
  activités liées, envois et événements de chaque campagne, enrôlements et
  étapes de workflow, soumissions de formulaires, score et règles qui y
  contribuent, fichiers joints (métadonnées), journal d'audit), rien sur d'autres personnes ni de technique
  (pas de jeton de consentement, de clés de recherche ou de doublons, ni des
  responsables) ; 2 000 lignes par table au plus, l'archive dit quelles tables
  ont été tronquées. *Droit
  d'opposition au profilage* : l'interrupteur arrête le scoring (score et
  détail effacés, plus jamais recalculés) et tout suivi comportemental : les
  ouvertures, clics et clics de liens suivis ne sont plus enregistrés du tout
  (ni événement de campagne, ni marqueur sur l'envoi, ni compteur, ni
  déclencheur de workflow, ni valeur posée par un lien suivi, qui redirige
  simplement), les événements de délivrabilité (délivré, rebond, plainte)
  restant consignés ; la fiche n'est pas touchée ; l'opposition se lève de la
  même façon. *Droit à l'effacement* : après confirmation, la fiche
  et tout ce qui lui appartient sont supprimés définitivement, par étapes
  planifiées (même cascade que la purge de rétention : notes, envois, jetons de
  liens et événements de campagne, enrôlements et étapes de workflow,
  historique de statut, soumissions de formulaires et jeton de visiteur,
  appartenances aux listes, paires de doublons, fichiers
  et leurs blobs, journal d'audit de la fiche, de ses notes et de ses
  enrôlements) ; une transaction ou une activité liée reste, sans lien, car
  elle appartient à l'organisation ; il ne reste qu'une ligne d'audit anonyme
  (identifiant, date, `rgpd: erasure`) et la ligne de `rgpdRequests`. Une
  étape qui échoue (Convex ne réessaie pas) laisse la demande « en cours » :
  un cron horaire la replanifie. Une fusion de doublons conserve l'opposition
  au profilage de la fiche absorbée. Un lead déjà dans la corbeille peut être
  effacé ; les sauvegardes s'éteignent avec
  leur rétention (`docs/`). L'API publique n'expose pas ces actions.
- **Auth** : Better Auth (`convex/auth.ts`) : code envoyé par e-mail, dont le
  lien connecte d'un clic, fournisseurs sociaux et SSO OpenID Connect. Seuls
  les utilisateurs `employee` accèdent au CRM.
- **API publique REST** : `/api/v1/` sur l'origine `.convex.site`, clés d'API à
  portées (*Paramètres → Clés d'API*), lecture et écriture des contacts,
  entreprises, transactions et activités, listes et propriétés en lecture.

## Structure

```
convex/              Backend Convex
  schema.ts          Tables et index
  http.ts            Le routeur HTTP : il assemble les routes que chaque fonctionnalité enregistre (`features/<nom>/routes.ts`)
  auth.ts, auth/     Better Auth et ses e-mails
  extensions.ts      Points d'accroche (voir Extensions)
  _lib/              Le socle : constructeurs de fonctions (auth, triggers) et validators du schéma
  features/<nom>/    Une fonctionnalité : queries, mutations, actions, internal
  lib/<domaine>/     Le code partagé d'un domaine (leads, email, security, extensions…), sans fonction Convex
  seed/, setup/      Premier employé, assistant de configuration initiale
src/
  design-system/     Composants d'interface
  widgets/           Auth, layouts, providers
  features/<nom>/    Une fonctionnalité : components/, hooks/, lib/, types.ts
  pages/             Une page par route : elle compose les composants de sa fonctionnalité, elle n'en définit pas
  lib/               backend.ts (ré-exports Convex), erreurs, navigation, pays
tests/               backend/ (convex-test), frontend/, setup.ts (voir Tests)
scripts/             Générateurs (OpenAPI, formats d'adresse)
docker/              Caddyfile + entrypoint de l'image de production
docs/                Contrats : API publique (openapi.yaml), extensions, connecteurs, secrets
```

Alias d'import : `@crm/*` → `./src/*` (déclaré dans `tsconfig.json` et
`vite.config.mts`).

Où va un nouveau fichier du backend : une fonction Convex (query, mutation,
action) dans `features/<fonctionnalité>/`, ses routes HTTP dans son
`routes.ts` ; ce que plusieurs fonctionnalités
partagent dans `lib/<domaine>/`, importé par son module, sans fichier
d'index ; un validator de table dans `_lib/validators/`.
Les imports descendent : `lib/` n'importe aucune fonctionnalité, et les
validators et les constantes de `_lib/` n'importent ni `lib/` ni `features/`
(`tests/backend/layering.test.ts`).

Côté interface : un composant, un hook ou un helper va dans
`src/features/<fonctionnalité>/` (un composant par fichier) ; `src/pages/` ne
garde que le composant de la page. Le backend n'est importé que par
`src/lib/backend.ts`.

Les règles que le code suit, chacune gardée par un test :

- **Un fichier écrit à la main tient en 400 lignes**, ou dit pourquoi il en
  fait plus (`tests/backend/fileSize.test.ts`).
- **Une fonction Convex déclare `args` et `returns`**
  (`tests/backend/returnValidators.test.ts`). Une ligne stockée se déclare
  avec `docOf('<table>')` (`convex/lib/shared/docs.ts`), une forme déjà nommée
  par son validator.
- **Un refus que la personne peut corriger est levé avec `refusal(code)`**
  (`convex/_lib/refusal.ts`), jamais avec `new Error('code')` : en production,
  Convex ne transmet au client que le contenu d'un refus, un `Error` y arrive
  sous la forme « Server Error ». Le détail va dans `reason`, une phrase
  destinée à la personne dans `message`. L'interface lit le tout avec
  `errorLabel` et `describeError` (`src/lib/errors.ts`). Un `Error` reste ce
  qu'il est : une anomalie.
- **Une règle que l'interface et le backend vérifient tous deux s'écrit une
  fois**, en zod, dans `convex/_lib/validators/fields.ts` (adresse e-mail, URL,
  couleur, pays, devise, entier borné ou positif, quantité non négative, jour).
  Ce qu'une étape de workflow doit contenir avant l'activation est dans
  `convex/_lib/validators/workflowSteps.ts` : l'éditeur l'affiche sous
  l'étape, le backend refuse l'activation avec la même phrase
  (`tests/frontend/workflowStepRules.test.ts`).
- **Un contact se crée à un seul endroit**, `createLeadRecord`
  (`convex/lib/leads/records.ts`) : la ligne, son entrée au journal, la
  première ligne de son historique de statut, puis les workflows
  (`tests/backend/leadCreation.test.ts`).
- **Une query ou une mutation ne lit que par son `ctx.db`**, soumis aux règles
  de visibilité de l'appelant. Ce que le déploiement compte (un plafond) est
  une query interne qui ne rend que des nombres ; chacune est listée, avec sa
  raison, dans `tests/backend/layering.test.ts`.
- **Une query ne lit une table entière, ou toute une plage d'index, que là où
  c'est petit par nature**, et le dit : chaque `.collect()` est listé avec sa
  raison dans `tests/backend/collects.test.ts` ; plus aucune lecture connue ne
  grandit avec l'usage.
- **Les compteurs d'une campagne vivent hors de la campagne**
  (`campaignStatShards`, seize lignes sommées à la lecture,
  `convex/lib/campaigns/stats.ts`) : un événement du fournisseur écrit une de
  ces lignes, jamais le document de la campagne, et un lot (envoi, renvoi)
  n'en écrit qu'une par transaction (`tests/backend/campaignStats.test.ts`).
- **Une écriture de contact ne coûte que ce qu'elle change**
  (`tests/backend/writeCost.test.ts`) : un contact est écrit une fois à sa
  création, un agrégat n'est touché que si la ligne y change de place, et les
  déclencheurs ne lisent que les listes dynamiques et les workflows actifs.
  Conséquence : une ligne écrite hors des mutations (tableau de bord Convex,
  `convex import`) n'entre dans les compteurs qu'à sa prochaine écriture qui
  la déplace (propriétaire, statut, entreprise, stade, montant, suppression).
- **Chaque page se charge à la demande** (`src/app.tsx`) ; le build échoue si
  un fichier dépasse 500 kB (`vite.config.mts`).
- **Une page ou une fonctionnalité peint avec les jetons du thème**
  (`src/design-system/theme.css`), jamais avec une couleur écrite à la main
  (`tests/frontend/colourTokens.test.ts`).

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
| `bun run typecheck` | tsconfig app + tsconfig convex + tsconfig tests |
| `bun run codegen` | régénère `convex/_generated` (commité) |
| `bun run openapi` | régénère `convex/lib/api/openapi.generated.ts` depuis `docs/openapi.yaml` (commité) |
| `bun run lint` | Biome : format et règles ; un avertissement fait échouer la commande |
| `bun run unused` | knip : exports, types, fichiers et dépendances que rien n'utilise (`knip.ts`) ; la CI échoue s'il en trouve. Ce qu'une surcouche importe est listé dans `tests/*/extensionSurface.test.ts` et compte comme utilisé |
| `bun run test` | lance les suites `bun:test` |
| `bun run test:watch` | idem, en mode watch |

### Tests

Tous les tests sont sous `tests/` (`backend/` avec `convex-test`, `frontend/`),
aucun dans `convex/` ni `src/`. `tests/setup.ts`, chargé avant chaque fichier
(`bunfig.toml`), pose trois règles :

- **Aucun test ne sort de la machine** : une requête que le test n'a pas
  simulée est refusée et fait échouer le test qui l'a émise.
- **Rien ne survit à un test** : à la fin de chacun, ce qu'il a planifié sans
  l'exécuter est annulé, pour ne pas s'exécuter plus tard dans un autre test.
- **L'horloge appartient au test** : un backend de test (`createTestConvex`)
  tourne sur une horloge que seul le test fait avancer ; rien de planifié ne
  part tout seul. `runDue(t)` exécute ce qui est dû maintenant, `runAfter(t,
  ms)` avance puis exécute, `runAll(t)` exécute tout, `pinClock(date)` fixe la
  date de départ.

Les tests sont typés comme le reste (`tests/tsconfig.json`, dans
`bun run typecheck`). La suite ne dépend pas de l'ordre : la CI la lance dans
un ordre aléatoire (`bun test --randomize`, la graine est affichée pour
rejouer un échec avec `--seed`).

### Bootstrap & connexion locale

Un déploiement neuf n'a aucun utilisateur : créer un premier employé (seuls
les utilisateurs `employee` accèdent au CRM) :

```bash
bunx convex run seed/devEmployee:createDevEmployee '{"email":"you@example.com","firstName":"You","lastName":"Example"}'
```

La connexion passe ensuite par un code envoyé par e-mail : il faut un
fournisseur d'e-mail configuré (Brevo ou SMTP, *Paramètres → E-mail*), et
l'adresse dans `DEV_WHITELIST_EMAILS` si la liste est définie. Il n'existe pas
de porte dérobée de session.

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
| `SECRETS_KEY` | non (**oui** en hébergement) | Clé maître, 32 octets en hexadécimal, qui chiffre les secrets stockés dans `appConfig` (clé et secret webhook Brevo, mot de passe SMTP, secrets des fournisseurs sociaux et SSO) en AES-256-GCM avant écriture ; ils ne sont déchiffrés qu'au point d'usage, jamais renvoyés au navigateur. Absente : les secrets restent en clair, avec un avertissement dans les journaux au premier écrit. Générer avec `bunx convex env set SECRETS_KEY $(openssl rand -hex 32)`, puis chiffrer l'existant avec `bunx convex run migrations:run '{"fn":"migrations:encryptAppConfigSecrets"}'`. Rotation : `docs/secrets.md`. |
| `SECRETS_KEY_NEXT` | non | Nouvelle clé pendant une rotation : les écritures l'utilisent, les lectures essaient les deux. Voir `docs/secrets.md`. |
| `CONNECTOR_GOOGLE_CLIENT_ID`, `CONNECTOR_GOOGLE_CLIENT_SECRET`, `CONNECTOR_MICROSOFT_CLIENT_ID`, `CONNECTOR_MICROSOFT_CLIENT_SECRET` | non | Application OAuth « gérée » d'un fournisseur de connecteurs, fournie par l'hébergeur : utilisée quand l'organisation n'a pas configuré et activé la sienne dans Réglages → Intégrations. Voir `docs/connectors.md`. |
| `OAUTH_CALLBACK_BASE` | non | Origine d'un répartiteur de callback OAuth : quand elle est définie, l'adresse de redirection des connecteurs devient `${OAUTH_CALLBACK_BASE}/oauth/callback`, et le répartiteur renvoie le navigateur vers `/connectors/callback` de ce déploiement. Le code est toujours échangé ici, jamais par le répartiteur. Absente : `${CONVEX_SITE_URL}/connectors/callback`. |
| `OAUTH_CALLBACK_TENANT` | avec `OAUTH_CALLBACK_BASE` | Identifiant de ce déploiement pour le répartiteur, placé dans l'état OAuth signé. |
| `OAUTH_STATE_SECRET` | avec `OAUTH_CALLBACK_BASE` | Clé de signature de l'état OAuth des connecteurs, partagée avec le répartiteur. Absente : clé dérivée de `BETTER_AUTH_SECRET`. |
| `API_KEY_HASH_SALT` | non | Sel du hachage SHA-256 des secrets de clés d'API (API REST publique `/api/v1/`, réglages → Clés d'API). Repli sur une valeur par défaut si absente — définir en prod **avant de créer la première clé** pour durcir les lignes `apiKeys` en cas de fuite de la base. Le sel entre dans chaque hachage : le changer invalide toutes les clés existantes (les secrets font 24 octets aléatoires, il ne se tourne donc jamais en routine). Générer avec `bunx convex env set API_KEY_HASH_SALT $(openssl rand -hex 16)`. |
| `FORM_IP_HASH_SALT` | non | Clé du HMAC-SHA256 qui pseudonymise les adresses IP stockées avec les soumissions de formulaires publics (`formSubmissions.ipHash`). Absente, une clé dérivée de `BETTER_AUTH_SECRET` sert. Générer avec `bunx convex env set FORM_IP_HASH_SALT $(openssl rand -hex 16)`. |

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
   bunx convex run features/campaigns/actions:registerBrevoEmailWebhook --prod
   bunx convex run features/campaigns/actions:registerBrevoSmsWebhook --prod
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
`providerId` (slug stable, utilisé dans l'URL de rappel : des mots en minuscules
et chiffres séparés par des tirets, 64 caractères au plus, refusé sinon), `label`, `issuerUrl`,
`clientId`, `clientSecret`, `scopes`, `enabled`. L'émetteur doit exposer un
document de découverte OIDC (`/.well-known/openid-configuration`) et émettre des
`id_token` standard. L'URL de rappel à déclarer dans la console du fournisseur est
`${CONVEX_SITE_URL}/api/auth/oauth2/callback/<providerId>` (affichée et copiable
dans l'assistant).

L'accès reste régi par le modèle sur invitation : à la première connexion, un
e-mail invité provisionne l'employé ; un e-mail non invité est refusé
(`not_invited`) — le même filtre que pour les fournisseurs sociaux et le lien
magique. Il n'y a donc ni `allowedDomains` ni `autoProvision` propres au SSO.

## API publique

Les systèmes tiers (Zapier / Make, back-offices, scripts) lisent et écrivent
les données du CRM en HTTPS, sur l'origine du déploiement Convex :

```
https://<deployment>.convex.site/api/v1/
Authorization: Bearer wap_<keyId>_<secret>
```

Les clés se créent dans *Paramètres → Clés d'API* (nom, portées, expiration
optionnelle). Le secret n'est affiché **qu'une fois** ; seule son empreinte
salée est stockée. Une clé se révoque sans délai ; sa création, sa modification
et sa révocation sont journalisées dans `auditLogs` (`entityType: 'apiKey'`).

> **Une clé voit et modifie toutes les fiches de l'organisation.** L'API est
> une surface serveur-à-serveur : les portées limitent les ressources, pas le
> périmètre — la grille rôles × modules et les équipes ne s'y appliquent pas.
> Pas d'en-têtes CORS : une clé ne doit jamais vivre dans un navigateur.

### Ressources et portées

| Ressource | Routes | Portées |
|---|---|---|
| Sonde | `GET /me` (nom, portées, expiration de la clé) | n'importe quelle clé valide |
| Contacts (leads) | `GET /contacts[?email=]`, `GET /contacts/:id`, `POST /contacts`, `POST /contacts/upsert`, `PATCH /contacts/:id`, `DELETE /contacts/:id` | `contacts:read` / `contacts:write` |
| Entreprises | `GET /companies[?domain=]`, `GET /companies/:id`, `POST`, `PATCH`, `DELETE` | `companies:read` / `companies:write` |
| Transactions | `GET /deals[?leadId=]`, `GET /deals/:id`, `POST`, `PATCH`, `DELETE` | `deals:read` / `deals:write` |
| Activités | `GET /activities[?leadId=]`, `GET /activities/:id`, `POST`, `PATCH`, `DELETE` | `activities:read` / `activities:write` |
| Listes | `GET /lists`, `GET /lists/:id/members` | `lists:read` (+ `contacts:read` pour les membres, qui sont des contacts complets) |
| Propriétés | `GET /properties?entityType=lead\|company\|deal\|activity` | `properties:read` |

Une portée d'écriture inclut la lecture de la même ressource (`contacts:write`
suffit pour lire les contacts et pour recevoir la fiche renvoyée par une
écriture). Les réponses sont des DTO explicites (`id`, `createdAt`, `updatedAt`,
champs publics) : jamais de document brut, jamais de jeton de consentement ni
de champ interne. Les fiches supprimées (soft delete) sont invisibles partout.

### Lecture

- Pagination par curseur : `?limit=` (50 par défaut, 100 max) et `?cursor=` ;
  réponse `{ "data": [...], "nextCursor": "..." | null }`. Une page peut être
  plus courte que `limit` (fiches supprimées filtrées) : itérer jusqu'à
  `nextCursor: null`, ne pas se fier à la taille de la page.
- Tri par date de création décroissante. Ce n'est pas un mécanisme de
  synchronisation incrémentale (prévu avec les webhooks sortants).

### Écriture

- Corps JSON ; `POST` renvoie `201` et la fiche, `PATCH` `200` et la fiche,
  `DELETE` `204` (suppression douce, comme l'interface).
- Contacts : `firstName`, `lastName` et `email` sont **obligatoires** sur
  `POST /contacts` et `POST /contacts/upsert` (`400 field_required`, le champ
  dans `details.field`), et `PATCH` ne peut ni les vider ni les passer à
  `null`. Le formulaire de l'interface applique la même règle.
- `PATCH` est partiel : seuls les champs fournis changent, `null` vide un champ
  optionnel. `customProperties` (clés = ids de `GET /properties`) fusionne
  clé par clé, `null` retire une clé ; un id de propriété inconnu est refusé
  (`unknown_property`).
- **Consentement en lecture seule** : `marketingConsent`, `consentSource`,
  `consentUpdatedAt` sont renvoyés mais refusés en écriture
  (`read_only_field`) — la trace RGPD reste celle de la page de consentement
  et des formulaires. Idem pour les champs calculés (score, compteurs).
- `POST /contacts` est une **création stricte** : un contact vivant avec le
  même e-mail (normalisé) renvoie `409 duplicate_email` avec l'`existingId`
  dans `details`. `PATCH` applique la même règle à un changement d'e-mail.
- `POST /contacts/upsert` **crée ou fusionne** par e-mail, avec
  les règles de l'import CSV : seuls les champs fournis écrasent, les
  propriétés fusionnent, une fiche supprimée est ravivée, le statut d'une
  fiche existante n'est jamais touché. Si plusieurs fiches partagent
  l'e-mail, la plus ancienne vivante gagne. Réponse
  `{ "created": true|false, "data": {…contact} }` (`201` / `200`).
- Rattachement d'entreprise d'un contact : `companyId` explicite, ou
  `company: { name, domain, registrationNumber, vatNumber, country }`
  (correspondance puis création), sinon la correspondance automatique par
  domaine de l'e-mail (entreprise **existante** uniquement).
- Nouvelle fiche : sans propriétaire sauf `ownerIds` fournis (employés
  vivants), statut par défaut sauf `lifecycleStage`, historique de statut avec
  la source `api`. Les déclencheurs de workflow (`lead_created`,
  `lead_property_changed`, `deal_*`) partent comme pour une écriture
  d'interface.
- Transactions : `POST /deals` sans `pipelineId` prend le pipeline par défaut
  et son premier stade. Un changement de stade passe par `PATCH { stageKey,
  stageTags?, stageComment? }` et respecte le graphe des transitions
  (`409 deal_transition_forbidden`, `409 stage_tag_required`). `status`,
  `closedAt` et `pipelineId` ne s'écrivent pas.
- Activités : `POST` accepte `status: open | done` ; `PATCH { status: 'done' }`
  horodate `completedAt`, `open` l'efface.

### Idempotence

Les clients qui rejouent leurs requêtes (Zapier, Make) envoient un en-tête
`Idempotency-Key` (1 à 255 caractères, unique par clé d'API) sur les `POST`.
Pendant 24 h, la même clé avec le même corps renvoie la **réponse enregistrée**
(en-tête `Idempotent-Replayed: true`) sans réécrire ; la même clé avec un corps
différent renvoie `422 idempotency_key_reused` ; une requête encore en cours
renvoie `409 idempotency_in_progress`. Sans cet en-tête, un `POST` rejoué crée
un doublon (sauf `/contacts/upsert`).

### Limites de débit

| Limite | Valeur | Clé |
|---|---|---|
| Requêtes | 600 / min | par clé d'API |
| Écritures (`POST`, `PATCH`, `DELETE`) | 300 / min, en plus de la précédente | par clé d'API |
| Échecs d'authentification | 10 / min | par adresse IP |

Dépassement : `429` avec `Retry-After` (secondes). Une adresse IP à court de
budget d'authentification est refusée avant toute recherche de clé en base.

### Erreurs

```json
{ "error": { "code": "invalid_fields", "message": "…", "details": { "path": ".email" } } }
```

Codes HTTP : `400` (corps ou champ invalide ou absent, id malformé, référence
inconnue — le `code` est le code d'erreur métier, ex. `field_required`, `invalid_owner`,
`invalid_address`, `unknown_stage`), `401` (clé absente, malformée, inconnue,
révoquée ou expirée — toujours le même corps), `403 missing_scope`,
`404 not_found`, `409` (conflit d'état : `duplicate_email`,
`company_domain_exists`, `lifecycle_regression_blocked`,
`deal_transition_forbidden`…), `422 idempotency_key_reused`, `429 rate_limited`,
`500 internal_error`.

### Journal et traçabilité

Chaque écriture par l'API produit une ligne `auditLogs` portant `apiKeyId` (et
pas d'`userId`) ; le fil d'activité des fiches l'affiche comme
`API · <nom de la clé>`. Les lectures ne sont pas journalisées : `lastUsedAt`
de la clé (rafraîchi au plus toutes les 5 min) et les logs Convex suffisent.

### Documentation OpenAPI

Le contrat est décrit dans `docs/openapi.yaml` (OpenAPI 3.1, relu comme du
code) et servi sans clé par le déploiement :

- `GET /api/v1/openapi.json` — le document, avec `servers` pointant sur le
  déploiement qui le sert ;
- `GET /api/v1/docs` — explorateur Swagger UI ; le bouton *Authorize* prend
  votre clé pour essayer les appels.

Après une modification du YAML, `bun run openapi` régénère le module servi
(`convex/lib/api/openapi.generated.ts`, commité) ; `tests/backend/openapi.test.ts`
vérifie que le module est à jour, que le document est un OpenAPI valide et
qu'il décrit exactement les routes du routeur avec leurs portées.

## Production

Le backend se déploie séparément : `bunx convex deploy` (+ `convex env set`
sur le déploiement de prod). Le frontend est une image Docker autonome :

```bash
docker build -t fabulous-crm .
docker run -d -p 8099:80 -e VITE_CONVEX_URL=https://<deployment>.convex.cloud fabulous-crm
```

Image multi-stage : build bun (tsc + vite) → `caddy:2-alpine` servant `dist/`
(cache immutable sur `/assets`, no-cache sur le HTML et `env.js`, fallback SPA).

### Après une mise à jour

- `bunx convex run migrations:backfillCampaignStats --prod` une fois, à la
  première version qui tient les compteurs d'une campagne (en attente, ignorés,
  ouverts, cliqués…) : chaque campagne antérieure est comptée depuis ses
  envois, par pages planifiées (environ 500 envois par page). À lancer à tout
  moment, campagne en cours d'envoi et événements du fournisseur compris : un
  envoi qui change pendant le comptage n'est compté qu'une fois. Jusque-là,
  une campagne antérieure affiche des zéros.
- Si les compteurs d'une campagne semblent faux :
  `bunx convex run features/campaigns/internal:recountCampaignStats '{"campaignId":"<id>"}' --prod`
  la recompte depuis ses envois, à tout moment et autant de fois que voulu.
- `bunx convex run features/workflows/internal:listWorkflowsToFix --prod`
  liste les workflows actifs ou en pause que l'activation refuserait avec les
  règles de la version déployée. Un workflow en faute continue de tourner,
  mais une fois mis en pause il ne se réactive plus avant d'être corrigé :
  mieux vaut le corriger avant.
- Chaque fonction Convex vérifie à l'exécution ce qu'elle rend (`returns`).
  Après un déploiement, une `ReturnsValidationError` dans les logs
  (`bunx convex logs --prod`) désigne une fonction qui rend un champ que son
  validator ne déclare pas.

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

## Extensions

Le CRM expose quelques points d'accroche typés, sans effet par défaut, pour qu'un
déploiement ajoute ses propres règles, pages et routes sans forker le code : refuser un
appel employé, enrichir la configuration publique, limiter invitations, créations de
contacts, envois et enrôlements, répondre à une requête d'API avant la route, ajouter des
routes HTTP, des tables, des pages et des entrées de menu, différer les traitements en
arrière-plan (préparation et envoi des campagnes, étapes de workflow) et refuser avec un
code structuré que l'interface sait afficher. Un *overlay* remplace `convex/extensions.ts`,
`convex/extensionsSchema.ts` et `src/extensions.tsx`. Le contrat est décrit dans
[`docs/extensions.md`](docs/extensions.md).

## Contribution et sécurité

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — workflow, vérifications avant commit, conventions.
- [`SECURITY.md`](SECURITY.md) — signalement d'une faille de sécurité.

## Origine

Le CRM a été extrait en juillet 2026 du monorepo est-santé, dont les notions
métier ont été retirées pour le rendre agnostique. Il en reste deux traces
voulues : le type de propriété personnalisée `rpps` (numéro de professionnel
de santé, vérifiable auprès de l'Annuaire Santé) et le seul type d'utilisateur
`employee`.

Note campagnes : le placeholder Brevo `{{ params.occupation }}` n'est plus
alimenté (rend vide) — retirer sa référence des templates Brevo existants.
