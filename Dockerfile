FROM node:24.22.1-alpine AS build
WORKDIR /app
ENV NUXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ARG NUXT_PUBLIC_SITE_URL=""
ENV NUXT_PUBLIC_SITE_URL=${NUXT_PUBLIC_SITE_URL}
RUN npm run postinstall && npm run generate

FROM nginx:1.30.6-alpine AS runtime
ARG NUXT_PUBLIC_SITE_URL=""
ARG VCS_REF=""
LABEL org.opencontainers.image.source="https://github.com/xiaowork-dev/xiaowork-homepage" \
      org.opencontainers.image.revision="${VCS_REF}" \
      io.xiaowork.site-url="${NUXT_PUBLIC_SITE_URL}"
COPY --chmod=644 deploy/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=644 deploy/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build --chown=nginx:nginx /app/.output/public /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health.json || exit 1
ENTRYPOINT ["nginx", "-g", "daemon off;"]
