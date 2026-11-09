#!/bin/bash
# Return xiaoworks.com to V1.0 using the newest saved original root.conf. V1.1 keeps running on loopback.
set -Eeuo pipefail
F=/opt/1panel/www/sites/xiaoworks.com/proxy/root.conf; C=1Panel-openresty-Pn9S
SAVE=$(ls -1 /opt/xiaowork-homepage-v11/release/root.conf.v10-* | tail -1)
grep -q 'proxy_pass http://127.0.0.1:3100;' $SAVE
cp -p $SAVE $F
docker exec $C openresty -t 2>&1 | tail -1
docker exec $C openresty -s reload
sleep 2
for path in / /projects/ /about/; do printf '%s ' $path; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 --resolve xiaoworks.com:443:127.0.0.1 https://xiaoworks.com$path; done
printf '/admin/ (expect 404 on V1.0) '; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 --resolve xiaoworks.com:443:127.0.0.1 https://xiaoworks.com/admin/
echo ROLLED_BACK_TO_V10
