#!/bin/sh
# Optional server add-ons, one `location ^~ /addon/<key>/` each (rules mirror backend/app/core/addons.py):
#  - container: ADDONS=key=origin,key=origin (and ADDON_URL, an alias of main=<origin>), proxied;
#  - static folder: <ADDONS_DIR>/<key>/addon.json (ADDONS_DIR default /addons), served read-only.
# A key that is both a container and a folder is the container. Everything is validated before anything
# is written; invalid input -> message on stderr, exit 1, nothing written. Nothing configured -> no file.
conf=${ADDON_CONF:-/etc/nginx/conf.d/addon.inc}
dir=${ADDONS_DIR:-/addons}
dir=${dir%/}
bad() { echo "add-ons: $1" >&2; exit 1; }

case "$dir" in
  /* ) ;;
  * ) bad "ADDONS_DIR must be an absolute path" ;;
esac
case "$dir" in
  *[!A-Za-z0-9._/-]* | *..* | *//* ) bad "ADDONS_DIR: invalid" ;;
esac

valid_key() {
  case "$1" in '' | *[!a-z0-9-]*) return 1 ;; esac
  [ "${#1}" -le 20 ]
}
valid_origin() {
  case "$1" in
    http://*) rest=${1#http://} ;;
    https://*) rest=${1#https://} ;;
    *) return 1 ;;
  esac
  case "$rest" in '' | *[!A-Za-z0-9.:_-]*) return 1 ;; esac
}

out=
seen=" "
add_container() {
  valid_key "$1" || bad "invalid key: $1"
  valid_origin "$2" || bad "invalid origin for $1"
  case "$seen" in *" $1 "*) bad "duplicate key: $1" ;; esac
  seen="$seen$1 "
  # Lazy resolution (Docker's DNS + a variable): the site starts even when the add-on is down and its
  # /addon/<key>/ answers 502 until it is up. The rewrite gives the add-on its own /addon/... path.
  out="$out
location ^~ /addon/$1/ {
    resolver 127.0.0.11 valid=10s ipv6=off;
    set \$addon_upstream \"$2\";
    rewrite ^/addon/$1/(.*)\$ /addon/\$1 break;
    include /etc/nginx/security-headers.conf;
    add_header Cache-Control \"no-store\" always;
    proxy_pass \$addon_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
    proxy_read_timeout 30s;
}
"
}

set -f
oldifs=$IFS
IFS=,
for item in ${ADDONS:-}; do
  IFS=$oldifs
  [ -n "$item" ] || { IFS=,; continue; }
  case "$item" in *=*) ;; *) bad "invalid ADDONS item" ;; esac
  add_container "${item%%=*}" "${item#*=}"
  IFS=,
done
IFS=$oldifs
if [ -n "${ADDON_URL:-}" ]; then
  add_container main "${ADDON_URL%/}"  # one trailing slash tolerated (ADDONS values: no)
fi

set +f
for d in "$dir"/*/; do
  [ -f "${d}addon.json" ] || continue
  key=${d%/}; key=${key##*/}
  valid_key "$key" || continue
  case "$seen" in *" $key "*) continue ;; esac
  # alias path = validated ADDONS_DIR + validated key only
  out="$out
location ^~ /addon/$key/ {
    auth_request /_auth;
    alias $dir/$key/;
    include /etc/nginx/security-headers.conf;
    add_header Cache-Control \"no-store\" always;
}
"
done

[ -n "$out" ] || exit 0
printf '%s\n' "$out" > "$conf.tmp" && mv "$conf.tmp" "$conf"
