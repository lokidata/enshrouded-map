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

Open the site: on an empty database the first visit must create the first account, with the setup code from `docker compose logs api` (or `SETUP_TOKEN` from `.env`), so that not just anyone who reaches the port first becomes the owner; after that only a logged-in user can send an invitation link (valid 20 minutes, single use).

## Updating the map

Run the pipeline (Windows PC), copy its output into `artifacts/map/` (or `ARTIFACTS_DIR`): nothing to restart, `map-data.json` is revalidated on each load.

## Backup / restore

```sh
./backup.sh                          # consistent copy of the database
docker compose cp backup.db api:/data/app.db   # restore (stop the stack first: docker compose stop)
```

## Notes

- `REVERSE_PROXY_IP` must be the address your reverse proxy connects from: nginx only trusts `X-Forwarded-For` from it, and the API only trusts nginx (`172.28.0.10`).
- The API runs a single worker because the login rate limit is counted in memory.
- Switching to PostgreSQL: add a `db` service, set `DATABASE_URL` and add `psycopg[binary]` to the image's requirements.
- CSP allows inline *styles* (Angular injects component styles at run time); scripts are `'self'` only.
