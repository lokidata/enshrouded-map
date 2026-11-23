#!/bin/sh
# Tests of 40-addon.sh: sh frontend/nginx/test-40-addon.sh
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d) && trap 'rm -rf "$tmp"' EXIT
fail=0
ko() { echo "FAIL: $1"; fail=1; }

# run <name> <expected exit> [VAR=value ...]; output file: $tmp/out.inc
run() {
  name=$1 want=$2; shift 2
  rm -f "$tmp/out.inc"; mkdir -p "$tmp/empty"
  env -i PATH="$PATH" ADDON_CONF="$tmp/out.inc" ADDONS_DIR="$tmp/empty" "$@" sh "$here/40-addon.sh" 2>"$tmp/err"
  got=$?
  [ "$got" = "$want" ] || ko "$name: exit $got, wanted $want"
}
has() { grep -qF -- "$2" "$tmp/out.inc" 2>/dev/null || ko "$1: missing: $2"; }
nofile() { [ ! -e "$tmp/out.inc" ] || ko "$1: file written"; }

run two 0 'ADDONS=a=http://a:8000,b=https://b.lan:9'
has two 'location ^~ /addon/a/ {'; has two 'rewrite ^/addon/a/(.*)$ /addon/$1 break;'
has two 'set $addon_upstream "http://a:8000";'
has two 'location ^~ /addon/b/ {'; has two 'rewrite ^/addon/b/(.*)$ /addon/$1 break;'
has two 'resolver 127.0.0.11'; has two 'Cache-Control "no-store"'; has two 'proxy_read_timeout 30s;'

run alias 0 ADDON_URL=http://x:1
has alias 'location ^~ /addon/main/ {'; has alias 'set $addon_upstream "http://x:1";'

run slash 0 ADDON_URL=http://x:1/
has slash 'set $addon_upstream "http://x:1";'
run slash2 1 ADDON_URL=http://x:1//; nofile slash2
run slash3 1 ADDONS=a=http://a:1/; nofile slash3

mkdir -p "$tmp/dirs/hello" "$tmp/dirs/nojson" "$tmp/dirs/Bad" "$tmp/dirs/both"
: > "$tmp/dirs/hello/addon.json"; : > "$tmp/dirs/Bad/addon.json"; : > "$tmp/dirs/both/addon.json"
run static 0 "ADDONS_DIR=$tmp/dirs" ADDONS=both=http://b:1
has static 'location ^~ /addon/hello/ {'; has static "alias $tmp/dirs/hello/;"
has static 'auth_request /_auth;'
grep -q 'nojson\|/Bad/' "$tmp/out.inc" && ko "static: folder without addon.json or bad key used"
grep -q "alias $tmp/dirs/both" "$tmp/out.inc" && ko "static: folder won over container"
[ "$(grep -c 'location ^~ /addon/both/' "$tmp/out.inc")" = 1 ] || ko "static: both not once"

run none 0; nofile none
run emptyitems 0 'ADDONS=,,'; nofile emptyitems

nl='
'
for bad in 'a=http://a b' 'A=http://a' 'a=http://a/p' 'a=ftp://a' 'a=http://a;x' 'a=http://a}' '=http://a' \
  'a=http://a,a=http://b' 'a' 'a=http://a"x' 'a=http://a$x' 'a=http://a`x`' "a=http://a${nl}b=http://b" \
  'a b=http://a' 'abcdefghijklmnopqrstu=http://a' 'a=http://' 'a=http://a//' '../x=http://a'; do
  run "bad[$bad]" 1 "ADDONS=$bad"; nofile "bad[$bad]"
done
run badurl 1 'ADDON_URL=http://a/p'; nofile badurl
run dup 1 ADDON_URL=http://a:1 ADDONS=main=http://b:1; nofile dup
run baddir 1 'ADDONS_DIR=relative/x'; nofile baddir
run baddir2 1 'ADDONS_DIR=/a b'; nofile baddir2
run baddir3 1 'ADDONS_DIR=/a;b'; nofile baddir3
run baddir4 1 'ADDONS_DIR=/a/../b'; nofile baddir4
# an invalid input must not leave a previous good file changed
: > "$tmp/prev.inc"
env -i PATH="$PATH" ADDON_CONF="$tmp/prev.inc" ADDONS_DIR="$tmp/empty" 'ADDONS=a=ftp://a' sh "$here/40-addon.sh" 2>/dev/null
[ ! -s "$tmp/prev.inc" ] || ko "previous file modified"

[ $fail = 0 ] && echo "all passed"
exit $fail
