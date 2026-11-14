#!/bin/sh
# Optional server add-on: the /addon/ proxy block exists only when ADDON_URL is set (origin only).
[ -n "$ADDON_URL" ] || exit 0
case "$ADDON_URL" in
  http://*[!A-Za-z0-9.:/_-]* | https://*[!A-Za-z0-9.:/_-]* | http://|https://) echo "ADDON_URL: invalid" >&2; exit 1 ;;
  http://* | https://*) ;;
  *) echo "ADDON_URL: invalid" >&2; exit 1 ;;
esac
cat > /etc/nginx/conf.d/addon.inc <<EOF
location ^~ /addon/ {
    include /etc/nginx/security-headers.conf;
    add_header Cache-Control "no-store" always;
    proxy_pass ${ADDON_URL%/};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
    proxy_read_timeout 30s;
}
EOF
