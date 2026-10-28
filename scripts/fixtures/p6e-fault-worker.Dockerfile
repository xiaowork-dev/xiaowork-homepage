# Test-only binary. Production Dockerfiles never reference p6e_fault or this file.
FROM xiaowork-homepage-api:p6b-test AS test-build
WORKDIR /src
COPY backend/ ./
RUN CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -tags=p6e_fault -trimpath -o /p6e-fault-worker ./cmd/p6e-fault-worker \
 && CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -tags=p6e_fault -trimpath -o /p6e-fault-api ./cmd/homepage-api \
 && CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -tags=p6e_fault -trimpath -o /p6e-fault-data ./cmd/p6e-fault-data

FROM xiaowork-homepage-api:p6d-dev AS api-test
COPY --from=test-build /p6e-fault-api /homepage-api

FROM xiaowork-homepage-worker:p6d-dev AS worker-test
COPY --from=test-build /p6e-fault-worker /p6e-fault-worker
ENTRYPOINT ["/p6e-fault-worker"]

FROM xiaowork-homepage-api:p6b-test AS data-test
COPY --from=test-build /p6e-fault-data /p6e-fault-data
ENTRYPOINT ["/p6e-fault-data"]
