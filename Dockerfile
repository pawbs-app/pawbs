# syntax=docker/dockerfile:1

# ---- build: the static app, built once on the builder's own platform (output is platform-neutral) ----
FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The commit being built, and a beta build's pre-release version ("1.16.16-beta.3"; empty: package.json's
# version), both passed by CI and shown in the app's Settings › About.
ARG BUILD_REF=""
ARG APP_VERSION=""
RUN npm run build

# ---- serve: Alpine's nginx with its Brotli module, as the unprivileged `nginx` user on port 8080 ----
# (Brotli serves the build's pre-compressed .br copies; the official nginx images lack the module.)
# CI builds this stage without its layer cache, so every image gets Alpine's current packages.
# `apk upgrade` covers the packages the alpine:3 image already holds (OpenSSL, zlib, musl…), which
# `apk add` leaves at the base image's versions.
FROM alpine:3 AS serve
LABEL org.opencontainers.image.title="pawbs"       org.opencontainers.image.url="https://pawbs.app" \
      org.opencontainers.image.description="A fast, installable viewer for image boards with a compatible JSON API" \
      org.opencontainers.image.licenses="AGPL-3.0-only AND OFL-1.1"
# nginx-mod-http-js (njs) runs the device transfer relay, deploy/sync.js.
RUN apk upgrade --no-cache \
 && apk add --no-cache nginx nginx-mod-http-brotli nginx-mod-http-js \
 && rm -f /etc/nginx/http.d/*.conf
COPY deploy/nginx-main.conf /etc/nginx/nginx.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/headers.conf /etc/nginx/nggallery-headers.conf
COPY deploy/sync.js /etc/nginx/nggallery-sync.js
COPY deploy/disguise.js /etc/nginx/nggallery-disguise.js
COPY deploy/errors/ /etc/nginx/nggallery-errors/
COPY deploy/check/ /etc/nginx/nggallery-check/
COPY --from=build /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
STOPSIGNAL SIGQUIT
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
# -e: log start-up errors to the output too (the default log file is not writable by `nginx`).
CMD ["nginx", "-e", "/dev/stderr", "-g", "daemon off;"]
