# Suite du site : progression, personnage, qualité Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter les 12 améliorations proposées après l'import de sauvegarde (#40) : progression, zone explorée, personnage/atelier, qualité et exploitation.

**Architecture:** Chaque tâche est livrable seule (une PR par phase, voire par tâche). La logique reste pure et testée (`*.logic.ts`, Vitest), l'UI en signals + Transloco FR/EN, le backend n'est touché que pour T4, T9 et T11. Les tâches T5 à T7 commencent par une vérification de faisabilité : si elle échoue, la tâche s'arrête et on le dit.

**Tech Stack:** Angular 22 (signals, signal forms), Leaflet, FastAPI + SQLAlchemy 2 + Alembic, Playwright, Vitest, `fzstd`.

**Spec:** pas de spec séparée ; contexte dans `docs/DESIGN-save-import.md`, `docs/RULES.md` (règles fonctionnelles) et la liste de propositions faite à l'utilisateur le 2026-11-10.

## Global Constraints

- Parler à l'utilisateur en français ; textes de l'interface en FR et EN (`frontend/public/i18n/{fr,en}.json`), même clé dans les deux.
- Pas de `standalone: true`, pas d'`OnPush` explicite, signals, `@if/@for`, `inject()` (voir `frontend/CLAUDE.md`).
- Design : jetons de `src/styles.css` seulement, `npm run lint` (garde de design) doit passer ; polices : toute nouvelle police est préchargée dans `src/index.html`.
- Chaque écran passe AXE (WCAG A et AA).
- Honnêteté des valeurs : exact / « estimation » / « — », jamais inventé (`docs/RULES.md` §7).
- Aucune vraie sauvegarde, `knowledge_map.json` ni donnée de jeu dans git (`artifacts/` est ignoré).
- Le pipeline (`pipeline/`) ne tourne que sur tora (`ssh -i ~/.ssh/tora lokid@tora`) : le modifier ici, le lancer là-bas seulement avec l'accord de l'utilisateur.
- Rien sur ahiru (prod) sans « go prod » ; pas de commit/PR sans « commit et pr » ; migrations Alembic portables SQLite/PostgreSQL (`batch_alter_table`).
- Vérification avant « fini » : `make check-backend`, `npm run lint`, `npx ng test --watch=false`, `npx playwright test` (arrêter les serveurs de dev avant : ports 8000/4200 ; avec la carte de test : `ln -sfn e2e/fixtures/map map-artifacts`, remettre `../artifacts/map` ensuite).
- Mettre à jour `docs/RULES.md`, `README.md`, `CLAUDE.md` avec chaque règle qui change.

## Review Focus

- Une sauvegarde sans section `fogofwar` ou sans `player_knowledge` : l'import et le tableau de progression ne doivent pas échouer (ligne absente, message clair).
- Un `map-data.json` ou `lore.json` plus ancien (sans `kids`/`kid`) : le tableau de progression montre « — » pour ces catégories, pas 0 % trompeur (T1).
- Orientation de la grille de brouillard : un lieu découvert doit tomber en cellule explorée ; une erreur de retournement donnerait un filtre faux sans erreur visible (T2).
- Zone partagée : un joueur qui quitte l'équipe ou retire son accord ne doit plus apparaître dans la fusion, et rien ne doit fuiter avant l'accord explicite (T4).
- Restauration d'une base : un fichier qui n'est pas une base valide ou d'une version de schéma inconnue ne doit jamais remplacer la base en cours (T11).

---

## Phase 1 : progression et zone explorée

### Task 1: Tableau de progression

**Files:**
- Create: `frontend/src/app/progress-summary/progress-summary.logic.ts`, `progress-summary.logic.spec.ts`, `progress-dialog.ts`
- Modify: `frontend/src/app/core/auth.service.ts` (signal `progressOpen`), `frontend/src/app/sidebar/account-bar.ts` (entrée de menu « Ma progression »), `frontend/src/app/app.ts` (`<app-progress-dialog />`), i18n FR/EN, `frontend/e2e/map.spec.ts`

**Interfaces:**
- Produces: `summarize(done: ReadonlySet<string>, craft: CraftData | null, lore: LoreData | null, markers: readonly MapMarker[], explored: number | null): Summary` avec `Summary = { lines: { kind: 'recipe'|'quest'|'lore'|'place'|'item'|'fog'; done: number; total: number | null }[] }` (`total: null` = donnée absente, affiché « — »).
- Consumes: `markId`, `pageMark`, `questMark` (déjà exportés), `fogShare` de `save-import/fog.ts`.

- [ ] **Step 1: Test `summarize counts each kind` :** recettes+blocs cochés `recipe:<guid>` sur le total de `craft.recipes + craft.blocks` ; quêtes `quest:<id>` ; pages `lore:<note>:<i>` ou `lore:<note>` entier ; lieux = marqueurs avec `kids` cochés ; objets = marqueurs `item` à un seul emplacement cochés ; `fog` = `explored` en pourcentage.
- [ ] **Step 2: Test `summarize reports missing data` :** sans `kids` sur aucun marqueur, la ligne `place` a `total: null` ; `craft`/`lore` null idem.
- [ ] **Step 3:** Implémenter `summarize` (fonction pure, un seul passage par liste).
- [ ] **Step 4:** `ProgressDialog` (modèle `save-import-dialog.ts`, styles `../auth/auth-dialog.css`) : une barre `role="progressbar"` par ligne, `aria-valuenow` ; l'étendue explorée vient de `FogStore` (0 si absente).
- [ ] **Step 5: e2e** `progress dialog shows the counts` : cocher une recette, ouvrir « Ma progression », attendre « 1 » sur la ligne recettes ; AXE sur la fenêtre.
- [ ] **Step 6:** `npm run lint && npx ng test --watch=false` puis `npx playwright test` ; commit.

### Task 2: Filtre « dans la zone explorée »

**Files:**
- Modify: `frontend/src/app/save-import/fog.ts` (`isExplored`, `decodeVeil`), `fog.store.ts` (cellules en mémoire), `frontend/src/app/core/filter.store.ts`, `frontend/src/app/map/map-view.ts` (`applyVisibility`), `frontend/src/app/sidebar/sidebar.ts`, i18n, spec
- Test: `frontend/src/app/save-import/save-import.spec.ts`, `frontend/e2e/map.spec.ts`

**Interfaces:**
- Produces: `isExplored(cells: Uint8Array, x: number, z: number, size: number): boolean` (cellule de 8 m, `col = floor(x/8)`, `row = floor((size - z)/8)`, explorée si `>= 128`, hors grille = faux) ; `FogStore.explored(x: number, z: number): boolean | null` (`null` sans import) ; `FilterStore.onlyExplored: WritableSignal<boolean>` (clé `localStorage` `onlyExplored`).
- Consumes: `veilPixels` (le voile est la seule copie conservée : décoder l'alpha du PNG, `alpha < 77` = exploré ; ne pas stocker la grille brute).

- [ ] **Step 1: Test `isExplored reads the grid north-up` :** grille synthétique 1280², un bloc à 255 en haut à gauche ; `isExplored(cells, 4, size - 4, size)` vrai, `(size - 4, 4)` faux, `(-5, 10)` faux.
- [ ] **Step 2: Valider l'orientation sur la vraie sauvegarde** (script esbuild dans le scratchpad, pas commité) : parmi les 199 lieux découverts de `character3.ksd`, au moins 90 % tombent en cellule explorée ; sinon tester `row = floor(z/8)` et corriger l'étape 3. Noter le résultat dans `docs/RULES.md`.
- [ ] **Step 3:** implémenter `isExplored` et `decodeVeil(url: string): Promise<Uint8Array>` (canvas `getImageData`, alpha seul) ; `FogStore` décode à la demande et expose `cells` en signal.
- [ ] **Step 4:** case « Seulement la zone explorée » dans la barre latérale (désactivée sans import, avec une note) ; `applyVisibility` masque les marqueurs `explored === false` (les marqueurs `region`/`areaName` restent visibles).
- [ ] **Step 5: e2e** : importer la fausse sauvegarde (quart supérieur gauche exploré), cocher le filtre, vérifier que le marqueur `fastTravel` (200, 700) reste et qu'un marqueur hors zone disparaît.
- [ ] **Step 6:** lint, tests, commit.

### Task 3: Réimport facilité

**Files:**
- Create: `frontend/src/app/save-import/import-history.ts`
- Modify: `save-import-dialog.ts`, i18n, spec

**Interfaces:**
- Produces: `rememberImport(entry: { name: string; at: string; counts: Record<Kind, number> }): void` et `lastImport(): ImportEntry | null` (clé `localStorage` `lastImport`, `try/catch`, effacée au logout par `SessionService.forget`).

- [ ] **Step 1: Test `lastImport round-trips and survives blocked storage`.**
- [ ] **Step 2:** après « Importer », enregistrer l'entrée ; l'aperçu affiche « Dernier import : <fichier>, <date> » et, par catégorie, « +N depuis » (le nombre « à cocher » existe déjà).
- [ ] **Step 3:** afficher le nom du fichier avec son numéro de personnage (`character3.ksd` → « Personnage 3 »), sans lire d'autre donnée.
- [ ] **Step 4:** étendre le test e2e d'import (la ligne « Dernier import » apparaît à la réouverture) ; lint, tests, commit.

### Task 4: Zone explorée partagée avec l'équipe (sur accord)

**Files:**
- Create: `backend/alembic/versions/0013_fog.py`, `backend/app/api/v1/fog.py`, `backend/tests/test_fog.py`
- Modify: `backend/app/db/models.py` (`Fog`), `backend/app/main.py` (routeur), `backend/app/core/config.py` (`max_fog_bytes = 300_000`), `frontend/src/app/save-import/fog.store.ts`, `save-import-dialog.ts`, `map-view.ts`, i18n, `docs/RULES.md`

**Interfaces:**
- Produces (API) : `PUT /api/v1/fog` corps `{ bits: string (base64 de 1280*1280/8 octets), shared: boolean }` ; `GET /api/v1/fog` renvoie la zone du joueur ; `GET /api/v1/team/fog` renvoie `{ bits: string | null, members: number }` = OR des zones des membres de l'équipe qui ont `shared = true` (404 sans équipe). Table `fogs(user_id PK/FK cascade, bits BLOB, shared bool, updated_at)`.
- Produces (front) : `FogStore.shared: signal<boolean>`, `FogStore.teamUrl: signal<string | null>` (voile d'équipe, couche « Zone explorée de l'équipe »).

- [ ] **Step 1: Tests backend** `test_fog_private_by_default` (un coéquipier ne voit rien sans `shared`), `test_fog_team_merge_is_or`, `test_leaving_team_removes_member`, `test_fog_size_limit` (400), `test_fog_requires_login`.
- [ ] **Step 2:** modèle + migration 0013 (`op.create_table`, portable) ; routes avec validation de la longueur exacte (204 800 octets décodés) ; la fusion se fait à la lecture, rien n'est stocké pour l'équipe.
- [ ] **Step 3:** front : case « Partager ma zone explorée avec mon équipe » (décochée par défaut) dans la fenêtre d'import ; envoi du bitmap seuillé (`>= 128`) ; couche d'équipe sur la carte, rechargée avec les marques des autres (60 s).
- [ ] **Step 4:** e2e : deux comptes en équipe, un seul partage, l'autre voit la couche ; retrait de l'accord la fait disparaître.
- [ ] **Step 5:** `make check-backend`, lint, tests, commit.

## Phase 2 : personnage et atelier

### Task 5: Étude de faisabilité de l'inventaire dans la sauvegarde (bloquant pour T6)

**Files:**
- Create: `docs/DESIGN-save-inventory.md` (résultat), outils temporaires dans le scratchpad

- [ ] **Step 1:** décompresser `player_character` et `character_data` de `character3.ksd` (copie dans `~/Téléchargements/`) ; chercher les identifiants d'objets (`ItemInfo.itemId` = FNV-1a du GUID, `guidId`) et des quantités.
- [ ] **Step 2:** si besoin, un agent opus sur tora lit les chemins d'écriture de l'inventaire dans `enshrouded.exe` (avec l'accord de l'utilisateur avant de lancer sur tora).
- [ ] **Step 3:** demander à l'utilisateur de comparer 5 objets et leurs quantités avec l'inventaire du jeu (impossible à tester sans lui).
- [ ] **Step 4:** écrire le verdict dans `docs/DESIGN-save-inventory.md` : décodable (format, sections, limites) ou non. **Si non, T6 est abandonnée** et on le dit.

### Task 6: Calculateur à partir de l'inventaire (si T5 réussit)

**Files:**
- Create: `frontend/src/app/save-import/inventory.ts` (+ spec)
- Modify: `save-import-dialog.ts` (ligne « Inventaire »), `frontend/src/app/core/project.store.ts` (ou `craft.calc.ts` `Choices.have`), i18n

**Interfaces:**
- Produces: `readInventory(section: Uint8Array): Map<number, number>` (id d'objet de connaissance → quantité) ; `inventoryToHave(inv: ReadonlyMap<number, number>, craft: Pick<CraftData, 'items'>): Record<string, number>` (guid → quantité, via `guidId`).
- Consumes: `Choices.have` du calculateur (« quantités possédées, elles arrêtent la décomposition »).

- [ ] **Step 1: Tests** `readInventory` (section synthétique) et `inventoryToHave` (objet inconnu ignoré, quantités additionnées).
- [ ] **Step 2:** implémenter selon le format établi en T5 ; ligne d'import facultative « Utiliser mon inventaire dans le calculateur » qui remplit `have` (écrase, avec confirmation).
- [ ] **Step 3:** e2e avec une section d'inventaire synthétique ; lint, tests, commit.

### Task 7: DPS plus complet (si les formules sont lisibles)

**Files:**
- Modify: `frontend/src/app/core/gear.logic.ts` (`weaponDps`, `weaponDamage`), `gear.logic.spec.ts`, `frontend/src/app/build/build.ts` (lignes DPS), i18n, `docs/RULES.md`
- Pipeline si besoin de données : `pipeline/build_gear.py`

**Interfaces:**
- Produces: `weaponDps(hit, seconds, opts?: { critChance?: number; critDamage?: number; speedMod?: number }): number | null`, résultats toujours étiquetés « estimation » tant qu'un point n'est pas confirmé en jeu.

- [ ] **Step 1:** agent opus sur tora (accord préalable) : formule des critiques (déjà exacte côté lignes « Chance/Dégâts critiques ») appliquée au coup, effet des compétences de rapidité sur la durée d'attaque, coup lourd (durée, multiplicateur) ; livrer les adresses et formules.
- [ ] **Step 2: Tests** `weaponDps with crits` (valeur attendue calculée à la main : coup 100, crit 20 % × 150 % → 110), `weaponDps keeps null for staves and fists`.
- [ ] **Step 3:** brancher chance et dégâts critiques (déjà calculés dans `build-rows.ts`) puis la rapidité ; ne rien afficher de non confirmé comme exact.
- [ ] **Step 4:** demander à l'utilisateur de comparer un DPS avec l'écran du jeu ; ajuster les étiquettes ; lint, tests, commit.

### Task 8: Comparer deux builds

**Files:**
- Create: `frontend/src/app/build/compare.logic.ts` (+ spec), `compare.ts`
- Modify: `frontend/src/app/build/build.ts` (extraire le calcul des lignes en fonction pure), `build-rows.ts`, `frontend/src/app/core/view.store.ts` (vue `compare` ou volet de `BuildsPanel`), i18n, e2e

**Interfaces:**
- Produces: `statsOf(build: BuildState, data: GearData, skills: SkillsData, world: World): StatLine[]` (extraction de ce que `build.ts` calcule aujourd'hui) ; `compare(a: StatLine[], b: StatLine[]): { key: string; a: number | null; b: number | null; delta: number | null }[]`.

- [ ] **Step 1: Test `compare computes deltas and keeps unknown values null`.**
- [ ] **Step 2:** extraire `statsOf` de `build.ts` (1000 lignes) sans changer son comportement : les 6 tests e2e de Personnage existants doivent rester verts avant de continuer.
- [ ] **Step 3:** écran : deux listes déroulantes (build enregistré ou « courant »), tableau des attributs, santé/mana/endurance, armure, protections, DPS par arme, écart coloré (`--ok`/`--bad`), valeurs « estimation » gardées en étiquette.
- [ ] **Step 4:** e2e `compare two saved builds` (deux builds de niveaux différents) + AXE ; lint, tests, commit.

## Phase 3 : qualité et exploitation

### Task 9: `put_progress` idempotent (course sur les marques)

**Files:**
- Modify: `backend/app/api/v1/progress.py`
- Test: `backend/tests/test_progress.py`

**Interfaces:**
- Produces: `PUT /progress` renvoie 200 même si une requête identique concurrente a déjà inséré les mêmes marques (plus de 409 `conflict` pour un doublon).

- [ ] **Step 1: Test `test_concurrent_identical_put_is_not_a_conflict` :** simuler l'`IntegrityError` du `commit` (insérer les lignes par une session parallèle entre la lecture et l'écriture) et vérifier 200 + marques présentes une seule fois.
- [ ] **Step 2:** sur `IntegrityError` : `db.rollback()`, relire `existing`, ré-insérer seulement le reste ; si l'erreur persiste, garder le 409.
- [ ] **Step 3:** `make check-backend` ; commit.

### Task 10: Pas de décalage à l'ouverture de l'Atelier

**Files:**
- Modify: `frontend/src/app/app.ts` (`@placeholder` des `@defer` de l'Atelier et des vues à barre de sous-onglets), `frontend/src/app/workshop/workshop.css`
- Test: `frontend/e2e/map.spec.ts`

- [ ] **Step 1: Test e2e `opening the workshop does not move the content` :** mesurer le haut de `.panel` 100 ms et 2 s après l'ouverture (tolérance 1 px).
- [ ] **Step 2:** `@defer (…) { … } @placeholder { <div class="subtabs-space"></div> }` avec la hauteur exacte de la barre de sous-onglets (39 px mesurés) ; dériver la hauteur d'une variable CSS partagée plutôt que d'un nombre écrit deux fois.
- [ ] **Step 3:** lint, tests, commit.

### Task 11: Sauvegarde et restauration de la base depuis l'administration

**Décision à confirmer avec l'utilisateur avant de coder :** téléchargement seul (sûr), ou aussi restauration par import. La restauration par l'API remplacerait la base sous un serveur qui tourne : le plan prévoit un **fichier déposé puis appliqué au prochain démarrage**, pas un remplacement à chaud.

**Files:**
- Create: `backend/app/api/v1/admin_backup.py`, `backend/tests/test_admin_backup.py`
- Modify: `backend/app/main.py`, `backend/app/db/session.py` (échange au démarrage), `frontend/src/app/auth/admin-dialog.ts`, i18n, `deploy/README.md`, `docs/RULES.md`

**Interfaces:**
- Produces: `GET /api/v1/admin/backup` (administrateur seulement) : fichier SQLite issu de `sqlite3.Connection.backup`, 501 `unsupported_database` hors SQLite ; `POST /api/v1/admin/restore` : valide puis dépose `restore.pending.db` à côté de la base.

- [ ] **Step 1: Tests** `test_backup_admin_only` (403 pour un joueur), `test_backup_is_a_valid_sqlite_db` (PRAGMA `integrity_check` = ok, table `users` présente), `test_restore_rejects_garbage_and_unknown_schema` (version Alembic absente ou plus récente : 400, rien déposé).
- [ ] **Step 2:** implémenter la sauvegarde ; vérifier la ligne `alembic_version` avant d'accepter une restauration.
- [ ] **Step 3:** au démarrage, si `restore.pending.db` existe, copier l'ancienne base en `app.db.bak` puis la remplacer (avant toute connexion) ; journaliser l'événement (`audit`).
- [ ] **Step 4:** boutons dans la fenêtre d'administration (télécharger ; envoyer un fichier avec confirmation « la base sera remplacée au prochain redémarrage ») ; documenter dans `deploy/README.md`.
- [ ] **Step 5:** `make check-backend`, e2e (téléchargement), commit. **Ne pas tester sur la base de production.**

### Task 12: Tests e2e Firefox et WebKit

**Files:**
- Modify: `frontend/playwright.config.ts` (projets `firefox`, `webkit`), `.github/workflows/ci.yml` (`npx playwright install --with-deps firefox webkit`), `Makefile`

- [ ] **Step 1:** ajouter les projets limités à un sous-ensemble (connexion, carte, Atelier > Autel, Partie, import de sauvegarde) via `grep` ou un tag `@cross` ; Chromium reste complet.
- [ ] **Step 2:** lancer en local ; corriger ou documenter chaque différence de rendu trouvée (en particulier la page Autel) ; ne pas masquer un échec en l'excluant sans le noter.
- [ ] **Step 3:** CI : temps d'exécution mesuré, sous-ensemble ajusté pour rester raisonnable ; commit.

---

## Ordre conseillé

1. **T9** (rapide, supprime un test instable) puis **T1**, **T2**, **T3** (même zone de code, valeur visible tout de suite).
2. **T10** et **T12** (qualité, indépendantes).
3. **T8** (extraction de `statsOf`) puis **T5** (étude) ; **T6** et **T7** seulement si leurs études réussissent.
4. **T4** (le plus lourd : backend, migration, vie privée) et **T11** (décision à prendre) en dernier.

Une PR par tâche pour T4, T8, T11 ; T1–T3 ensemble, T9/T10/T12 ensemble.
