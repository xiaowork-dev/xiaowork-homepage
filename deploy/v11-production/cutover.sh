#!/bin/bash
# Switch xiaoworks.com upstream from V1.0 (127.0.0.1:3100) to V1.1 (127.0.0.1:3110). Automatic revert on any failed check.
set -Euo pipefail
F=/opt/1panel/www/sites/xiaoworks.com/proxy/root.conf; C=1Panel-openresty-Pn9S
SAVE=/opt/xiaowork-homepage-v11/release/root.conf.v10-$(date -u +%Y%m%dT%H%M%SZ)
grep -q 'proxy_pass http://127.0.0.1:3100;' $F || { echo "REFUSE: root.conf is not the expected V1.0 upstream"; exit 1; }
curl -sf -o /dev/null -H 'Host: xiaoworks.com' http://127.0.0.1:3110/ || { echo "REFUSE: V1.1 not answering on 3110"; exit 1; }
cp -p $F $SAVE && echo "saved original to $SAVE ($(sha256sum $SAVE | cut -c1-16))"
revert() { cp -p $SAVE $F && docker exec $C openresty -t >/dev/null 2>&1 && docker exec $C openresty -s reload && echo "REVERTED to V1.0: $1"; exit 1; }
sed -i 's#proxy_pass http://127.0.0.1:3100;#proxy_pass http://127.0.0.1:3110;#' $F
docker exec $C openresty -t 2>&1 | tail -1 | grep -q successful || revert "openresty -t failed"
docker exec $C openresty -s reload || revert "reload failed"
sleep 2
for path in / /projects/ /about/ /robots.txt /sitemap.xml /admin/; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve xiaoworks.com:443:127.0.0.1 https://xiaoworks.com$path); echo "$path $code"
  [ "$code" = 200 ] || revert "$path returned $code"
done
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve xiaoworks.com:443:127.0.0.1 https://xiaoworks.com/api/admin/v1/auth/session); echo "/api/admin/v1/auth/session $code"; [ "$code" = 401 ] || revert "session endpoint returned $code"
echo CUTOVER_OK
