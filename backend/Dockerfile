# syntax=docker/dockerfile:1
FROM python@sha256:cb33f7f771ecec2ef1225cf39b159591a040391bd73e4c01f00fdfc4c47611d2 AS build
WORKDIR /build
# Dependencies pinned and hash-checked (requirements.lock comes from `make lock`).
COPY requirements.lock .
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --require-hashes --only-binary=:all: -r requirements.lock

FROM python@sha256:cb33f7f771ecec2ef1225cf39b159591a040391bd73e4c01f00fdfc4c47611d2
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
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
ENTRYPOINT ["docker-entrypoint.sh"]
