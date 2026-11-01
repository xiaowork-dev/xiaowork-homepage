# Isolated P6-E maintenance tests only. Never a formal six-role release image.
FROM golang:1.27.3-alpine AS tests
WORKDIR /src
COPY go.mod go.sum ./
COPY vendor ./vendor
ENV GOFLAGS=-mod=vendor GOPROXY=off GOTOOLCHAIN=local
COPY . ./
RUN CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go test -c -o /tests/gate ./internal/maintenancegate \
 && CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go test -c -o /tests/httpapi ./internal/httpapi \
 && CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go test -c -o /tests/worker ./internal/publishworker \
 && CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -o /tests/control ./cmd/homepage-control \
 && go vet ./...

# Reuse reviewed offline Nuxt dependencies only; current Go tests/Runner below
# contain the new barrier. This derived image cannot attest a formal release.
FROM xiaowork-homepage-worker:p6e-chain3-4f18eaeaecb8 AS test-runtime
USER root
COPY --from=tests /tests /tests
COPY --from=tests /tests/control /homepage-control
COPY --from=tests /src/seed /tests/seed
RUN mkdir -p /control && chown 10001:10001 /control && chmod 700 /control
USER 10001:10001
WORKDIR /tests/internal/httpapi
LABEL io.xiaowork.p6e.test-only="maintenance-barrier"
LABEL org.opencontainers.image.revision="unfrozen-maintenance-tests"
ENTRYPOINT ["/tests/gate"]
