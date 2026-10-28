FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
ARG GOPROXY=https://proxy.golang.org,direct
RUN GOPROXY=${GOPROXY} go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -trimpath -ldflags="-s -w" -o /homepage-maintenance ./cmd/homepage-maintenance
RUN mkdir -p /mounts/source/db /mounts/source/uploads /mounts/source/publications /mounts/source/secrets /mounts/source/authority /mounts/source/tls /mounts/target/db /mounts/target/uploads /mounts/target/publications /mounts/target/secrets /mounts/target/authority /mounts/target/tls /mounts/backup \
    && chown -R 10001:10001 /mounts \
    && find /mounts -type d -exec chmod 700 {} +

FROM scratch
ARG VCS_REF=""
LABEL org.opencontainers.image.source="https://github.com/xiaowork-dev/xiaowork-homepage" \
      org.opencontainers.image.revision="${VCS_REF}"
COPY --from=build /homepage-maintenance /homepage-maintenance
COPY --from=build --chown=10001:10001 /mounts/ /
USER 10001:10001
ENTRYPOINT ["/homepage-maintenance"]
