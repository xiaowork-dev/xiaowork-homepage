FROM node:24.22.1-alpine AS build
WORKDIR /admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY admin/ ./
RUN npm run build

FROM nginx:1.30.6-alpine AS runtime
ARG VCS_REF=""
LABEL org.opencontainers.image.source="https://github.com/xiaowork-dev/xiaowork-homepage" \
      org.opencontainers.image.revision="${VCS_REF}"
COPY --chmod=644 deploy/harden-nginx.sh /tmp/harden-nginx.sh
RUN sh /tmp/harden-nginx.sh && rm /tmp/harden-nginx.sh
COPY --from=build --chown=10001:10001 /admin/dist /srv/admin
COPY --chmod=644 deploy/admin-dev/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=644 deploy/admin-dev/locations.conf /etc/nginx/xiaowork-locations.conf
COPY --chmod=644 deploy/admin-dev/admin-headers.conf /etc/nginx/xiaowork-admin-headers.conf
COPY --chmod=644 deploy/admin-dev/admin-locations.conf /etc/nginx/xiaowork-admin-locations.conf
USER 10001:10001
EXPOSE 8080 8443
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=6 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/health.json"]
ENTRYPOINT ["nginx", "-g", "daemon off;"]
