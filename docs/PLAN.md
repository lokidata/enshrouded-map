# Plan — Carte Enshrouded en vraie application (Angular + FastAPI + BDD, Docker)

## Context

Aujourd'hui la carte est un prototype qui marche bien mais reste artisanal :
- `map/index.html` : ~820 lignes de JS/CSS dans un seul fichier (Leaflet via CDN unpkg, menu en cartes, marquage, filtres).
- `map/server.py` : serveur `http.server` maison + SQLite (comptes PBKDF2, sessions, marques, filtres).
- Pipeline d'extraction Python (`voxels.py`, `extract_*.py`, `render_map.py`, `build_data.py`, `build_resources.py`, `eml_mod/`) qui dépend du jeu installé sous Windows, de `emm.exe` et de ~6,5 Go de fichiers intermédiaires (`unpacked/`, `export/`).
- Pas de dépôt git, pas de tests, pas de conteneur.

Avis : oui, c'est une bonne évolution — le front devient maintenable (composants, typage), le backend gagne un vrai cadre (validation, ORM, migrations, tests), et Docker rend le déploiement reproductible derrière ton reverse proxy. Deux points structurants :
1. **Le pipeline d'extraction ne va pas dans Docker** : il a besoin du jeu, d'`emm.exe` (Windows) et de Go de données. Il reste un outil hors-ligne qui produit des *artefacts* (tuiles, icônes, données de carte JSON) ; l'application ne fait que les servir. Mettre à jour la carte = relancer le pipeline puis redéployer les artefacts.
2. **Les données de carte restent statiques** (JSON + tuiles servis par le serveur web, cachés). La BDD ne contient que ce qui est propre aux utilisateurs (comptes, sessions, progression, filtres). Les ids de marquage restent `catégorie:x:z`, stables entre régénérations.

Choix validés : SQLite (via ORM + Alembic, URL configurable → PostgreSQL/MySQL possible sans changer le code), réseau local derrière ton reverse proxy (TLS terminé par lui), docker compose multi-conteneurs, base repartie de zéro.

## Architecture cible

```
enshrouded-map/                      (nouveau dépôt git, à côté des données brutes)
├─ pipeline/        scripts actuels déplacés tels quels + README (sortie → artifacts/map/)
├─ artifacts/map/   tiles/, icons/, biomes.png, map-data.json (+ resources.json)  [hors git, monté en lecture seule]
├─ backend/         FastAPI + SQLAlchemy 2 + Alembic + Pydantic v2 (uv, pytest, ruff, mypy)
├─ frontend/        Angular (standalone + signals), Leaflet via npm, i18n FR/EN
└─ deploy/          docker-compose.yml, nginx.conf, .env.example
```

Services compose (un process par conteneur, réseau interne) :
- **web** : nginx-unprivileged — sert le build Angular + `artifacts/map` (volume `:ro`), proxifie `/api/` vers `api`. Seul port publié (configurable, ex. `8080`, lié à l'IP LAN pour ton reverse proxy).
- **api** : FastAPI sous uvicorn (non publié). Migrations Alembic au démarrage (entrypoint) avant de servir.
- **SQLite** : fichier dans un volume nommé `db-data` monté sur `api` (WAL activé). Pour PostgreSQL plus tard : ajouter un service `db` + changer `DATABASE_URL`.

## Étapes

### 1. Socle du dépôt
- `git init`, `.gitignore` (artifacts, `*.db`, `node_modules`, `.venv`), `.editorconfig`, pre-commit (ruff, ruff-format, mypy, eslint/prettier, gitleaks, detect-secrets).
- Déplacer `map/*.py` + `map/eml_mod/` dans `pipeline/` ; `build_data.py` écrit `map-data.json` (JSON pur au lieu de `window.MAP_DATA = …` dans `markers.js`) et `resources.json` séparé (chargé seulement quand une catégorie ressource est cochée) dans `artifacts/map/`. Réutiliser tel quel : `voxels.py`, `extract_surface.py`, `extract_ores.py`, `render_map.py`, `build_resources.py`.
- Supprimer à terme `map/server.py` et `map/index.html` (gardés pendant la migration comme référence de comportement).

### 2. Backend `backend/`
- Structure : `app/main.py`, `app/core/config.py` (pydantic-settings, tout par variables d'env), `app/core/security.py`, `app/db/{base,session,models}.py`, `app/api/v1/{auth,progress,settings,health}.py`, `app/schemas/`, `alembic/`.
- Modèles SQLAlchemy (portage de `Store` dans `map/server.py`) : `User`, `Session` (hash SHA-256 du token, expiration), `Mark` (PK user_id+mark_id), `UserSettings` (JSON). Types portables (pas de spécificité SQLite) pour basculer vers PostgreSQL/MySQL.
- API `/api/v1` : `POST auth/register|login|logout`, `GET auth/me`, `GET/PUT progress` (lot d'ids), `GET/PUT settings`, `GET health`. Même contrat fonctionnel que l'actuel `server.py` (validation des ids `^[A-Za-z]+:-?\d+:-?\d+$`, limites de taille).
- Sécurité :
  - Mots de passe **Argon2id** (argon2-cffi), longueur min 10, refus des mots de passe trop communs ; comparaison en temps constant, coût identique si l'utilisateur n'existe pas (anti-énumération).
  - Sessions opaques côté serveur, cookie `HttpOnly; SameSite=Strict; Path=/`, `Secure` activé par config (TLS sur ton proxy), rotation à la connexion, expiration glissante, révocation à la déconnexion.
  - **CSRF** double-submit compatible Angular (`XSRF-TOKEN` cookie → en-tête `X-XSRF-TOKEN`), vérifié sur toutes les requêtes non-GET.
  - Rate limiting (slowapi) sur login/register + verrouillage progressif par compte ; IP client depuis `X-Forwarded-For` **uniquement** si la requête vient des proxys de confiance (`FORWARDED_ALLOW_IPS`).
  - Inscription désactivable / sur code d'invitation (`ALLOW_REGISTRATION`, `INVITE_CODE`) — utile même en LAN.
  - Pydantic strict sur toutes les entrées, taille max des corps, erreurs génériques (pas de stack trace), logs structurés JSON sans secrets, journal des événements d'authentification.
  - Pas de CORS (même origine), docs OpenAPI désactivées en production.
- Tests pytest (httpx AsyncClient, base SQLite temporaire) : auth, CSRF, rate limit, progression, filtres, validation, migrations Alembic up/down.

### 3. Front `frontend/` (Angular, standalone, signals)
Portage composant par composant de `map/index.html` :
- `MapComponent` : Leaflet (npm, plus de CDN), CRS simple, `toLatLng`, couche de tuiles, marqueurs à icônes dont la taille suit le zoom, étiquettes de régions/lieux, points en canvas créés à la demande pour les ressources, style « fantôme » des éléments faits, popups avec bouton marquer / clic droit.
- `SidebarComponent` : sections de cartes (`SECTIONS`), sous-listes d'éléments, recherche, Tout/Rien, compteurs fait/total.
- `AuthDialogComponent`, `AccountComponent`.
- Services : `MapDataService` (charge `map-data.json`, `resources.json` à la demande), `FilterStore` (signals ; logique `filterState`/`applyFilterState` actuelle, sauvegarde différée vers `/settings`), `ProgressStore` (marquage optimiste + rollback), `AuthService`, intercepteur HTTP (XSRF natif Angular, gestion 401).
- i18n FR/EN à la volée (Transloco) ; les noms du jeu restent ceux de `map-data.json`.
- Qualité : ESLint (angular-eslint), tests unitaires (Vitest/Jest) des stores, e2e Playwright (connexion, marquage, filtres persistés).
- Utiliser le serveur MCP de l'Angular CLI (`ng mcp`) pour les bonnes pratiques et la génération, et le skill *frontend design* pour le menu.

### 4. Conteneurs & déploiement `deploy/`
- **Dockerfiles multi-étapes** : `backend` (python:3.12-slim, deps verrouillées par hash via uv, utilisateur non-root, pas de compilateurs dans l'image finale), `frontend` (node build → nginx-unprivileged). Images de base épinglées par digest.
- `docker-compose.yml` : `read_only: true` + `tmpfs` là où il faut, `cap_drop: [ALL]`, `security_opt: no-new-privileges`, limites mémoire/CPU, healthchecks, `restart: unless-stopped`, réseau interne pour `api`, seul `web` publié, secrets via `.env` (non versionné, `.env.example` fourni).
- `nginx.conf` : en-têtes de sécurité (CSP stricte sans inline — possible avec le build Angular et Leaflet local, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`), cache long pour tuiles/icônes, `ETag`/revalidation pour `map-data.json`, gzip/brotli, `client_max_body_size`, `real_ip` limité à l'IP de ton reverse proxy. HSTS laissé à ton reverse proxy.
- Sauvegarde : commande documentée de copie à chaud SQLite (`sqlite3 .backup`) depuis le volume.

### 5. Chaîne qualité / sécurité
- CI locale (script `make check` ou équivalent) : ruff, mypy, pytest, bandit, pip-audit ; eslint, tests front, `npm audit` ; **Trivy** (images + config compose) ; gitleaks.
- Revue finale avec les skills `/security-review` et `/code-review` avant de considérer la migration terminée.

## Fichiers clés existants à réutiliser
- `map/server.py` : `Store` (schéma, règles de marquage), `MARK_ID`, limites, `RateLimit` → modèle pour le backend.
- `map/index.html` : `SECTIONS`, `filterState`/`applyFilterState`, `refreshDot`/`styleMarker`, `dotsLayer`, `iconSize`, `toLatLng`/`markId` → logique à porter dans Angular.
- `map/build_data.py` (sortie `markers.js` → `map-data.json`), `map/build_resources.py`, `map/render_map.py`, `map/voxels.py` : pipeline inchangé sur le fond.

## Vérification
1. `pipeline/` : régénération complète → `artifacts/map/` identique fonctionnellement (mêmes comptes de marqueurs/ressources qu'aujourd'hui : 1057 marqueurs, 2702 coffres, 6632 minerais, 76742 plantes).
2. Backend : `pytest` vert (dont tests CSRF, rate limit, migrations), `alembic upgrade head` sur base vide, puis même suite avec `DATABASE_URL` PostgreSQL éphémère pour valider la portabilité.
3. Front : tests unitaires + Playwright (inscription, marquage d'un boss/coffre, rechargement → marques et filtres restaurés, FR/EN).
4. `docker compose up -d --build` : healthchecks verts, carte chargée via le port publié, vérification dans le navigateur (preview) ; en-têtes contrôlés (`curl -I`), CSP sans violation en console, `docker compose exec api` montre un utilisateur non-root, Trivy sans vulnérabilité critique.
5. Test derrière ton reverse proxy (cookie `Secure`, IP réelle dans les logs de connexion).
