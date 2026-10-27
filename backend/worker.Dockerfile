FROM node:24.22.1-alpine AS builder-source
WORKDIR /builder
ENV NUXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY app/ ./app/
COPY shared/ ./shared/
COPY server/ ./server/
COPY public/ ./public/
COPY nuxt.config.ts tsconfig.json ./

FROM golang:1.27.3-alpine AS worker-build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
ARG GOPROXY=https://proxy.golang.org,direct
RUN GOPROXY=${GOPROXY} go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -trimpath -ldflags="-s -w" -o /homepage-worker ./cmd/homepage-worker

FROM node:24.22.1-alpine AS runtime
ARG VCS_REF
ARG BUILDER_ID=xiaowork-nuxt-p6d-v1
LABEL org.opencontainers.image.source="https://github.com/xiaowork-dev/xiaowork-homepage" \
      org.opencontainers.image.revision="${VCS_REF}" \
      io.xiaowork.builder="${BUILDER_ID}"
COPY --from=builder-source /builder /builder
COPY --from=worker-build /homepage-worker /homepage-worker
RUN mkdir -p /publications /uploads /run/publishing /work \
    && chown -R 10001:10001 /publications /uploads /run/publishing /work \
    && chmod 700 /publications /uploads /run/publishing /work
USER 10001:10001
WORKDIR /work
# Dependencies and reviewed source are installed in the image; the worker has no network.
ENTRYPOINT ["/homepage-worker"]
