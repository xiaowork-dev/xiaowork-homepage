# Test-only fault-injection images derived from an exact, already-built release
# group. Production Dockerfiles never reference this file or the p6e_fault tag,
# and these images are never written into a release descriptor.
#   docker build -f scripts/fixtures/v11-fault-images.Dockerfile \
#     --build-arg API_BASE=<api image id> --build-arg WORKER_BASE=<worker image id> \
#     --build-arg GATEWAY_BASE=<gateway image id> --target <api-test|worker-test|data-test|gateway-broken> .
ARG API_BASE
ARG WORKER_BASE
ARG GATEWAY_BASE

FROM golang:1.27.3-alpine AS test-build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
ARG GOPROXY=https://proxy.golang.org,direct
RUN GOPROXY=${GOPROXY} go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -tags=p6e_fault -trimpath -o /p6e-fault-worker ./cmd/p6e-fault-worker \
 && CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -tags=p6e_fault -trimpath -o /p6e-fault-api ./cmd/homepage-api \
 && CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -tags=p6e_fault -trimpath -o /p6e-fault-data ./cmd/p6e-fault-data

# API with the fixed SQLite checkpoint function registered (inactive unless the
# dedicated test trigger is installed in the test database).
FROM ${API_BASE} AS api-test
COPY --from=test-build /p6e-fault-api /homepage-api
LABEL io.xiaowork.test-only="fault-injection"

# Worker whose publication store pauses at a fixed activation checkpoint.
FROM ${WORKER_BASE} AS worker-test
COPY --from=test-build /p6e-fault-worker /p6e-fault-worker
LABEL io.xiaowork.test-only="fault-injection"
ENTRYPOINT ["/p6e-fault-worker"]

# Fixed SQLite helper: trigger-on | trigger-off | inspect (no arbitrary SQL).
FROM ${API_BASE} AS data-test
COPY --from=test-build /p6e-fault-data /p6e-fault-data
LABEL io.xiaowork.test-only="fault-injection"
ENTRYPOINT ["/p6e-fault-data"]

# Candidate gateway whose fixed executable is missing: start must fail so the
# lifecycle tool's automatic previous-service restoration can be exercised.
FROM ${GATEWAY_BASE} AS gateway-broken
USER 0
RUN rm -f /usr/sbin/nginx
USER 10001:10001
LABEL io.xiaowork.test-only="fault-injection"
