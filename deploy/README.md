# Deployment

On a server with Portainer, see [portainer/README.md](portainer/README.md) (images from GHCR). This page is the local / compose-from-source setup.

Two containers behind your reverse proxy (it terminates TLS and adds HSTS):

- `web`: nginx. Serves the Angular build and the map data (`artifacts/map`, mounted read-only), proxies `/api/` to `api`. The only published port.
- `api`: FastAPI. Runs the Alembic migrations at start, then one uvicorn worker. Reachable only from `web` (internal network). SQLite lives in the `db-data` volume.

## First start

```sh
cp .env.example .env     # then edit: WEB_BIND, REVERSE_PROXY_IP, COOKIE_SECURE=true behind TLS
docker compose up -d --build
```

Passkeys (optional): set `WEBAUTHN_RP_ID` (host name, no IP) and `WEBAUTHN_ORIGIN` (`https://…`) in `.env`. Players then add passkeys from the profile menu and can sign in with them; the password keeps working. The challenges are kept in the API process (single uvicorn worker).

Open the site: on an empty database the first visit must create the first account, with the setup code from `docker compose logs api` (or `SETUP_TOKEN` from `.env`), so that not just anyone who reaches the port first becomes the owner; after that only a logged-in user can send an invitation link (valid 20 minutes, single use).

## Updating the map

Run the pipeline (Windows PC), copy its output into `artifacts/map/` (or `ARTIFACTS_DIR`): nothing to restart, `map-data.json` is revalidated on each load.

The tab icon is `enshrouded-icon.png` in the same folder (not in git; the official site's `icon-192.png` works). It is the only file served without a session, so that the login page has an icon too; without it the tab simply has none.

## Backup / restore

```sh
./backup.sh                          # consistent copy of the database
docker compose cp backup.db api:/data/app.db   # restore (stop the stack first: docker compose stop)
```

## Notes

- `REVERSE_PROXY_IP` must be the address your reverse proxy connects from: nginx only trusts `X-Forwarded-For` from it, and the API only trusts nginx (`172.28.0.10`).
- Optional server add-ons (`ADDONS`, `ADDONS_DIR`, `ADDONS_PATH`, in `.env`):
  - Container add-on: `ADDONS=key=http://host:port,key2=...` (key `[a-z0-9-]{1,20}`, origin only, no path; `ADDON_URL=<origin>` still works and means `main=<origin>`). The web container proxies `/addon/<key>/...` to it, rewritten to `/addon/...` (the add-on never knows its key). The name is resolved at request time: the site starts even if the add-on is down, `/addon/<key>/` answers 502 until it is up. The add-on checks the session itself.
  - Static add-on: a folder `<key>/` holding `addon.json` and its files, in `ADDONS_PATH` (default `./addons`, mounted read-only on `/addons` in `api` and `web`). Served at `/addon/<key>/...`, for logged-in sessions only. A key that is both a container and a folder is the container.
  - A malformed `ADDONS` stops the web container at start (message in its log); unset: no block, no tab.
  - After deploying, open Administration: add-ons start disabled. Enable each entry, then grant access per account (the administrator always has full access once it is enabled).
  - Ship the site and the add-on together: the add-on's manifest `api_version` (2) must match the site, so update both in the same deployment.
  - Upgrading to the release that brings contract v2: add-ons stay hidden until enabled and granted again (no import of old lists); `ADDON_URL` tolerates one trailing slash, an `ADDONS` value with one stops the web container (remove it); `ADDONS` must have no spaces after the commas.
  - The chestsort editor also reads `item-names.json` from the map data (see `pipeline/`; optional).
- The API runs a single worker because the login rate limit is counted in memory.
- Switching to PostgreSQL: add a `db` service, set `DATABASE_URL` and add `psycopg[binary]` to the image's requirements.
- CSP allows inline *styles* (Angular injects component styles at run time); scripts are `'self'` only.

## Passwords

- Anyone can change their own password (**Compte** in the menu). The **first account** can also generate a single-use reset link (valid 20 minutes) for another user there.
- If the first account itself loses its password, reset it from the server:
  `docker compose exec -it api python -m app.cli reset-password USERNAME` (on Portainer: the `api` container's Console, command `python -m app.cli reset-password USERNAME`, with *Interactive & TTY*).

## Releases

SemVer `vMAJOR.MINOR.PATCH`, first release `v0.1.0` (0.x: the data formats and the database still change; `v1.0.0` when the site is stable). The version lives in `backend/pyproject.toml` and `frontend/package.json` / `package-lock.json` (same number, no `v`).

1. In a PR: bump the three files, merge, wait for CI green on `main`.
2. `git tag v0.2.0 && git push origin v0.2.0` (on the merged `main` commit).
3. Two workflows start on the tag: **Release** (checks tag = file versions, creates the GitHub release with notes generated from the merged PRs, grouped by label through `.github/release.yml`; a tag with `-rc1` is a pre-release) and **Publish images** (scan, push `0.2.0`, `0.2`, `latest`, sign).
4. Check the release page and `ghcr.io/lokidata/enshrouded-map-{api,web}:0.2.0`. A wrong tag: delete the release and the tag, fix, tag again.
5. Portainer: set `IMAGE_TAG=0.2.0` (instead of `latest`) and redeploy.

Label PRs `enhancement`, `bug`, `documentation` for the notes; `skip-changelog` hides one.

## Updating from 0.5.x: add-ons are managed by the site (0.6.0)

Only matters if you run the optional server add-on (or want to). Details of the new setup are in the "Optional server add-ons" part above and in [`docs/addons.md`](../docs/addons.md).

- **Update the site and the add-on together.** Add-on 0.6.0 speaks manifest v2: an older add-on shows nothing behind this site, and the new add-on needs this site.
- **Add-ons start disabled and the old access lists are not imported.** The migration (0018) runs by itself. Open Administration, enable each entry, then grant access again.
- **Check your `.env` before restarting**: `ADDON_URL` is an origin (one trailing slash is tolerated); in `ADDONS` no trailing slash and no space after a comma, otherwise the web container stops at start (the reason is in its log).
- The add-on is now reached at `/addon/<key>/` (`/addon/main/` for `ADDON_URL`); `#addon/server` links keep working.
- New: static add-ons (a folder in `ADDONS_PATH`, no container), and the docs site (GitHub Pages).

## Updating from 0.4.x or older: the data files changed (0.5.0)

`craft`, `gear`, `lore`, `skills` and `gems` are now split by language: next to `craft.json` the server needs `craft.fr.json`, `craft.en.json` and `craft.de.json` (same for the four others), and the base files themselves change. The new site cannot read the old files (the Workshop, Lore, Character and Skills screens would not load), and the old site cannot read the new ones: **copy the new data files and update the images together**.

- **Run the pipeline again** (`build_data.py`, see `pipeline/README.md`): it writes the split files, then copy the whole output to the artifacts folder.
- **No game data at hand**: split the files you already have with `python pipeline/split_languages.py <artifacts folder>` (no game install needed; it refuses a file that is already split). Only languages the files were built with exist (fr, en, de from 0.2.0).
- A new language later needs a pipeline run (its game texts), not only this script.
