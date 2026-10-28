FROM nginx:1.30.6-alpine AS runtime
ARG VCS_REF=""
LABEL org.opencontainers.image.source="https://github.com/xiaowork-dev/xiaowork-homepage" \
      org.opencontainers.image.revision="${VCS_REF}"
COPY --chmod=644 deploy/harden-nginx.sh /tmp/harden-nginx.sh
RUN sh /tmp/harden-nginx.sh && rm /tmp/harden-nginx.sh
COPY --chmod=644 deploy/admin-publish/static.conf /etc/nginx/nginx.conf
COPY --chmod=644 deploy/security-headers.conf /etc/nginx/security-headers.conf
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=6 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/health.json"]
ENTRYPOINT ["nginx", "-g", "daemon off;"]
