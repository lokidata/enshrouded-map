E2E_SETUP_TOKEN = e2e-setup-token-0123

.PHONY: check check-backend check-frontend check-security lock stack e2e-stack scan

# Code quality, tests, dependencies, secrets, images. e2e-stack is separate: it wipes the compose database.
check: check-backend check-frontend check-security

check-backend:
	cd backend && uv run ruff check . && uv run ruff format --check . \
	  && uv run mypy app tests && uv run bandit -q -r app \
	  && uv run pip-audit && uv run pytest -q

check-frontend:
	cd frontend && npm audit --omit=dev && npx ng lint && npx ng build && npx ng test --watch=false && npx playwright test

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
	cd deploy && SETUP_TOKEN=$(E2E_SETUP_TOKEN) docker compose down -v && SETUP_TOKEN=$(E2E_SETUP_TOKEN) docker compose up -d --build --wait
	cd frontend && PROTECTED_ASSETS=1 SETUP_TOKEN=$(E2E_SETUP_TOKEN) npx playwright test -c playwright.stack.config.ts

scan:
	docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache -v $(CURDIR):/src:ro aquasec/trivy:latest image --severity HIGH,CRITICAL --ignore-unfixed enshrouded-map-api:local
	docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache -v $(CURDIR):/src:ro aquasec/trivy:latest image --severity HIGH,CRITICAL --ignore-unfixed enshrouded-map-web:local
	docker run --rm -v $(CURDIR):/src:ro aquasec/trivy:latest config /src/backend
	docker run --rm -v $(CURDIR):/src:ro aquasec/trivy:latest config /src/frontend
