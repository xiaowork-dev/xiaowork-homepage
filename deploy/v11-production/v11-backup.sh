#!/bin/bash
# Daily consistent local backup of the production V1.1 project. Never deletes old backups.
set -Eeuo pipefail
PT=/opt/xiaowork-homepage-v11; P=xiaowork-homepage-v11-prod
export PATH=$PT/.tools/node/bin:/usr/sbin:/usr/bin:/sbin:/bin; unset DOCKER_HOST DOCKER_CONTEXT
umask 077
TS=$(date -u +%Y%m%dT%H%M%SZ); B=$PT/backups/$TS; LOG=$PT/logs/backup-$TS.log
avail=$(df --output=avail -B1M $PT/backups | tail -1 | tr -d ' ')
if [ "$avail" -lt 2048 ]; then echo "$TS REFUSED low disk ${avail}MiB" >> $PT/logs/backup-status.log; exit 1; fi
cd $PT/app
if node scripts/v11-release.mjs backup --project $P --backup $B > $LOG 2>&1; then
  echo "$TS OK files=$(find $B -type f | wc -l) size=$(du -sh $B | cut -f1)" >> $PT/logs/backup-status.log
else
  rc=$?; echo "$TS FAILED exit=$rc see $LOG" >> $PT/logs/backup-status.log; exit $rc
fi
