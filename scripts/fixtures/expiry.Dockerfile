FROM xiaowork-homepage-api:p6b-test AS build
COPY admin-session-expire.go /fixture.go
RUN GOPROXY=off GOTOOLCHAIN=local CGO_ENABLED=0 go build -trimpath -o /expire-session /fixture.go
FROM scratch
COPY --from=build /expire-session /expire-session
USER 10001:10001
ENTRYPOINT ["/expire-session"]
