FROM mcr.microsoft.com/playwright:v1.62.1-noble
USER root
RUN apt-get update && apt-get install --no-install-recommends -y libnss3-tools fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
USER pwuser
ENTRYPOINT ["node", "/browser-server.cjs"]
