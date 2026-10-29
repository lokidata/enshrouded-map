# syntax=docker/dockerfile:1
FROM node@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx ng build

FROM nginxinc/nginx-unprivileged@sha256:09b0d3eda2aa592d2487f284519419015cab010d7df16cd0fe224b585fc60eb6
COPY --from=build /build/dist/frontend/browser /usr/share/nginx/html
# Fixed packages that the pinned base image does not have yet (zlib, musl, brotli); Dependabot moves the base forward.
USER root
RUN apk upgrade --no-cache zlib musl musl-utils brotli-libs
# Config baked into the image: nothing to mount, so the same image runs from compose or Portainer.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf
USER 101
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD ["wget", "-qO-", "http://127.0.0.1:8080/healthz"]
