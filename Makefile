E2E_SETUP_TOKEN = e2e-setup-token-0123
E2E_USER = e2e-admin
E2E_COMPOSE = docker compose -f docker-compose.yml -f compose.e2e.yml

.PHONY: e2e-browsers check check-backend check-frontend check-security lock stack e2e-stack scan

# Code quality, tests, dependencies, secrets, images. e2e-stack is separate: it wipes the compose database.
check: check-backend check-frontend check-security

check-backend:
	cd backend && uv run ruff check . && uv run ruff format --check . \
	  && uv run mypy app tests && uv run bandit -q -r app \
	  && uv run pip-audit && uv run pytest -q

check-frontend:
	sh frontend/nginx/test-40-addon.sh
	cd frontend && npm audit --omit=dev && npm run lint && npx ng build && npx ng test --watch=false && npx playwright test

# Firefox and WebKit run the tests tagged @cross, each with its own API and database.
e2e-browsers:
	cd frontend && npx playwright install --with-deps firefox webkit \
	  && E2E_BROWSER=firefox npx playwright test && E2E_BROWSER=webkit npx playwright test

check-security: gitleaks scan

gitleaks:
	docker run --rm -v $(CURDIR):/repo:ro ghcr.io/gitleaks/gitleaks:latest dir /repo --no-banner --redact

# Pinned, hash-checked dependencies for the API image.
lock:
	cd backend && uv export --frozen --no-dev --no-emit-project --format requirements-txt -o requirements.lock

stack:
	cd deploy && docker compose up -d --build

# Same Playwright tests as `check-frontend`, against the compose stack on an empty database.
e2e-stack:
	cd deploy && SETUP_TOKEN=$(E2E_SETUP_TOKEN) $(E2E_COMPOSE) down -v && SETUP_TOKEN=$(E2E_SETUP_TOKEN) ARTIFACTS_DIR=../frontend/e2e/fixtures/map $(E2E_COMPOSE) up -d --build --wait
	cd frontend && PROTECTED_ASSETS=1 E2E_USER=$(E2E_USER) SETUP_TOKEN=$(E2E_SETUP_TOKEN) npx playwright test -c playwright.stack.config.ts
	# the add-on spec logs in as the account map.spec.ts created, so it runs second, on its own
	cd frontend && ADDON_STACK=1 E2E_USER=$(E2E_USER) SETUP_TOKEN=$(E2E_SETUP_TOKEN) npx playwright test -c playwright.stack.config.ts addon-stack

scan:
	docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache -v $(CURDIR):/src:ro aquasec/trivy:latest image --severity HIGH,CRITICAL --ignore-unfixed enshrouded-map-api:local
	docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache -v $(CURDIR):/src:ro aquasec/trivy:latest image --severity HIGH,CRITICAL --ignore-unfixed enshrouded-map-web:local
	docker run --rm -v $(CURDIR):/src:ro aquasec/trivy:latest config /src/backend
	docker run --rm -v $(CURDIR):/src:ro aquasec/trivy:latest config /src/frontend

# Docs site (prototype): gathers the public docs into .site-src, then builds with MkDocs Material.
docs-src:
	rm -rf .site-src && mkdir .site-src
	cp docs/*.md .site-src/ && cp README.md .site-src/index.md
	cp pipeline/README.md .site-src/pipeline.md && cp deploy/README.md .site-src/deploy.md && cp frontend/CLAUDE.md .site-src/frontend.md
	sed -i -e 's#](docs/RULES.md)#](RULES.md)#; s#](docs/TODO.md)#](TODO.md)#; s#](docs/addons.md)#](addons.md)#; s#](pipeline/README.md)#](pipeline.md)#; s#](pipeline)#](pipeline.md)#' \
	  -e 's#](deploy/portainer/README.md)#](https://github.com/lokidata/enshrouded-map/blob/main/deploy/portainer/README.md)#; s#](SECURITY.md)#](https://github.com/lokidata/enshrouded-map/blob/main/SECURITY.md)#; s#](LICENSE)#](https://github.com/lokidata/enshrouded-map/blob/main/LICENSE)#' .site-src/index.md
	sed -i 's#](portainer/README.md)#](https://github.com/lokidata/enshrouded-map/blob/main/deploy/portainer/README.md)#' .site-src/deploy.md
	sed -i 's#](../deploy)#](deploy.md)#' .site-src/pipeline.md
docs: docs-src
	uvx --with mkdocs-material mkdocs build
docs-serve: docs-src
	uvx --with mkdocs-material mkdocs serve
