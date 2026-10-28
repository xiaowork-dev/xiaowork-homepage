#!/bin/sh
set -eu

# These optional modules are never loaded by XiaoWork's checked-in configs.
# Removing their package roots also removes curl, libxml2 and brotli dependencies.
# No package repositories or arbitrary scripts are fetched at runtime or build time.
apk --no-network del \
  curl gettext-envsubst \
  nginx-module-acme nginx-module-geoip nginx-module-image-filter \
  nginx-module-njs nginx-module-xslt

# Keep the core server and BusyBox wget used by health checks. Fail closed if
# a future upstream package dependency silently brings the unused parsers back.
nginx -v
command -v wget >/dev/null
for package in curl libcurl libxml2 brotli brotli-libs; do
  if apk --no-network info -e "$package" >/dev/null 2>&1; then
    echo "Unexpected optional runtime package: $package" >&2
    exit 1
  fi
done
