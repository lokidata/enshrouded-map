# syntax=docker/dockerfile:1
# The tag keeps Dependabot on Python 3.12 (a digest alone follows `latest`, which moved to 3.15 without wheels for the locked dependencies).
FROM python:3.15-slim@sha256:65a65fc7b30b06cb6df4930fd4650697cb23f4c2698ab81fc87e4b031bc36928 AS build
WORKDIR /build
# Dependencies pinned and hash-checked (requirements.lock comes from `make lock`).
COPY requirements.lock .
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --require-hashes --only-binary=:all: -r requirements.lock

FROM python:3.15-slim@sha256:65a65fc7b30b06cb6df4930fd4650697cb23f4c2698ab81fc87e4b031bc36928
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
# Fixed packages that the pinned base image does not have yet (apt); Dependabot moves the base forward.
RUN apt-get update && apt-get install -y --no-install-recommends --only-upgrade apt libapt-pkg7.0 zlib1g \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app \
 && mkdir /data && chown app /data
COPY --from=build /opt/venv /opt/venv
# pip is only needed to install the dependencies (build stage): remove it, with its CVEs, from the final image.
RUN /opt/venv/bin/python -m pip uninstall -y pip && /usr/local/bin/python -m pip uninstall -y pip
WORKDIR /srv
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY docker-entrypoint.sh /usr/local/bin/
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=3)"]
ENTRYPOINT ["docker-entrypoint.sh"]
