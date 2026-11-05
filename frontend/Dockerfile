# syntax=docker/dockerfile:1
# The tag keeps Dependabot on Node 24 Alpine (a digest alone follows `latest`, which moved to Node 26).
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx ng build

# The tag keeps Dependabot on the Alpine variant (a digest alone follows `latest`, which is Debian).
FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e
COPY --from=build /build/dist/frontend/browser /usr/share/nginx/html
# Fixed packages that the pinned base image does not have yet (zlib, musl, brotli, curl, libexpat); Dependabot moves the base forward.
USER root
RUN apk upgrade --no-cache zlib musl musl-utils brotli-libs curl libcurl libexpat
# Config baked into the image: nothing to mount, so the same image runs from compose or Portainer.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf
USER 101
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD ["wget", "-qO-", "http://127.0.0.1:8080/healthz"]
