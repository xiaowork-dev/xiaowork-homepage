FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
ARG GOPROXY=https://proxy.golang.org,direct
RUN GOPROXY=${GOPROXY} go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -trimpath -ldflags="-s -w" -o /homepage-api ./cmd/homepage-api \
    && mkdir -p /runtime/data /runtime/uploads \
    && chmod 700 /runtime/data /runtime/uploads

FROM scratch AS runtime
COPY --from=build /homepage-api /homepage-api
COPY --from=build --chown=10001:10001 /runtime/ /
USER 10001:10001
ENV XIAOWORK_DB_PATH=/data/content.sqlite XIAOWORK_LISTEN=:8081
EXPOSE 8081
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=6 \
    CMD ["/homepage-api", "healthcheck"]
ENTRYPOINT ["/homepage-api"]
CMD ["serve"]
