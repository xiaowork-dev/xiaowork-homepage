#!/bin/bash
# Production shadow deployment of V1.1 (openresty topology, loopback only). Does NOT touch OpenResty or V1.0.
set -Eeuo pipefail
PT=/opt/xiaowork-homepage-v11; T=/opt/xiaowork-homepage-v11-test
S=c81af02da2c40104804cba33fd0146de3dd0980b; G=${S:0:12}; P=xiaowork-homepage-v11-prod
NODE=node-v24.22.1-linux-x64.tar.xz
unset DOCKER_HOST DOCKER_CONTEXT
[ -e $PT ] && { echo "REFUSE: $PT already exists"; exit 1; }
for p in 3110 3111; do ss -ltnH "sport = :$p" | grep -q . && { echo "REFUSE: port $p in use"; exit 1; }; done
docker ps -a --format '{{.Names}}' | grep -q "^$P-" && { echo "REFUSE: containers for $P exist"; exit 1; }
umask 022; mkdir -m 755 $PT; mkdir -m 700 $PT/.tools $PT/backups $PT/logs $PT/release
# Node: official tarball, checksum re-verified against the official SHASUMS256 list
(cd $T/.tools/dl && grep " $NODE\$" SHASUMS256.txt | sha256sum -c -)
mkdir $PT/.tools/node && tar -xJf $T/.tools/dl/$NODE -C $PT/.tools/node --strip-components=1
export PATH=$PT/.tools/node/bin:$PATH; echo "node $(node --version) at $(command -v node)"
# Tooling checkout at the accepted commit (state lives in the ignored .v11-deploy/ inside it)
git clone --quiet https://github.com/xiaowork-dev/xiaowork-homepage.git $PT/app
git -C $PT/app checkout --quiet --detach $S
test "$(git -C $PT/app rev-parse HEAD)" = "$S" && test -z "$(git -C $PT/app status --porcelain)" && echo "tooling at $S clean"
install -m 600 $T/descriptor-$G.json $PT/release/descriptor-$G.json
cd $PT/app
node scripts/v11-release.mjs deploy --project $P --manifest $PT/release/descriptor-$G.json --topology openresty --http-port 3110 --https-port 3111 --subnet 192.168.240.0/28 > $PT/logs/deploy-$(date -u +%Y%m%dT%H%M%SZ).log 2>&1 || { echo "DEPLOY FAILED"; exit 1; }
echo "deploy ok"
docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' $(docker ps -q --filter label=com.docker.compose.project=$P) | sort | uniq -c
docker ps --filter label=com.docker.compose.project=$P --format '{{.Names}}|{{.Status}}|{{.Ports}}' | sort
echo PROD_SETUP_DONE
