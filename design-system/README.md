# Codex of the Shroud: design system

Identité visuelle d'Enshrouded map, extraite pour être réutilisée. CSS pur, sans framework. Aperçu : ouvrir `index.html` (servi en HTTP, pas en `file://`, à cause des polices).

## Utiliser dans un autre projet

1. Copier le dossier `design-system/` (ou seulement `fonts/`, `licenses/` et les 4 CSS).
2. `<link rel="stylesheet" href="design-system/codex.css">`, ou importer `tokens.css`, `base.css`, `components.css` à la carte.
3. Précharger les polices dans le `<head>` (voir `index.html`), sinon le texte saute au changement de police.
4. Garder `licenses/` (polices sous licence OFL).

Les chemins des polices sont relatifs à `fonts.css`. Si le dossier `fonts/` bouge, changer les `url()` de ce fichier.

## Fichiers

| Fichier | Rôle |
|---|---|
| `tokens.css` | variables `:root` : couleurs, polices, coins de plaque, grain, brume |
| `fonts.css` | `@font-face` des 3 familles, auto-hébergées |
| `base.css` | reset, corps, titres, focus, barres de défilement fines, mouvement réduit |
| `components.css` | `.plate`, `.btn`, `.pill`, `.chip`, champs, `.tabs`, `h2.cx`, `.label`, `.empty`, `.cards` |

## Règles

- **Jetons seulement.** Aucun hex dans un composant : ajouter un jeton dans `tokens.css`. Noir et blanc avec alpha permis pour ombres et contours.
- **Rôles de couleur.** Sol bleu-ardoise froid (`--bg`, `--panel`). Bronze (`--gold`, `--gold-dim`) pour lignes et titres. Braise (`--accent`) uniquement pour ce qui est actif, ouvert ou focalisé, jamais en décoration. `--shroud` violet pour le lore. `--ok` / `--bad` pour l'état.
- **Typo.** `--display` (IM Fell English) pour titres et longue lecture. `--display-sc` (IM Fell English SC) pour étiquettes et onglets, en petites capitales : jamais `text-transform: uppercase`. `--ui` (Alegreya Sans) pour le reste. Ces polices n'ont qu'une graisse : pas de `font-weight: 700` sur `--display*`.
- **Plaques.** Carte, dialogue ou popup : bordure 1 px, rayon 3 px au plus (50 % et 999 px pour points et pilules), deux coins bronze de 2 px (`--plate-corners`, `--plate-corners-lit` si survolée ou choisie). Titre de section : losange sur le filet (`h2.cx`).
- **Performance.** Pas de `background-attachment: fixed`, pas de grosses ombres floues, pas d'animation 60 fps de grands dégradés (utiliser `steps()`).
- **Accessibilité.** WCAG AA : focus visible en braise, contrastes testés avec AXE, `prefers-reduced-motion` respecté.

## Non repris

Les couleurs propres à la carte et aux compétences (`--halo-*`, `--magic-*`, `--mana`, `--void`) restent dans `frontend/src/styles.css` : ce sont des données du jeu, pas l'identité. Le garde-fou `frontend/scripts/check-design.mjs` ne couvre pas ce dossier.

## Source

Copie de `frontend/src/styles.css` et de `frontend/src/app/workshop/workshop.css`. Pas synchronisée automatiquement : si les jetons changent là-bas, les reporter ici.
