#!/bin/bash
# ============================================================
#  Waya Surf School — deploy a Hostinger
#  Uso:  ./deploy-hostinger.sh
#
#  Hace: build de Vite -> zip -> subida TUS -> deploy
#  OJO: el deploy SOBRESCRIBE public_html por completo y no tiene undo.
# ============================================================
set -euo pipefail

USERNAME="u422629444"
DOMAIN="wayasurf.com"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
ZIP="$TMP/waya.zip"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

command -v hostinger >/dev/null || {
  echo "✗ Falta el CLI. Instálalo con: brew install hostinger/tap/hostinger" >&2
  exit 1
}

echo "▸ 1/4  Compilando…"
cd "$ROOT"
npm run build >/dev/null

[ -f "$ROOT/dist/index.html" ] || { echo "✗ El build no generó dist/index.html" >&2; exit 1; }
[ -f "$ROOT/dist/.htaccess" ] || echo "  ⚠ dist/.htaccess no está — revisa public/.htaccess"

echo "▸ 2/4  Empaquetando…"
cd "$ROOT/dist"
zip -rq "$ZIP" . -x ".DS_Store" -x "*/.DS_Store"
SIZE=$(stat -f%z "$ZIP")
# LC_NUMERIC=C: en locale español bc devuelve punto y printf espera coma, y con
# `set -e` ese fallo de formato abortaba el deploy entero.
echo "        $(LC_NUMERIC=C awk -v b="$SIZE" 'BEGIN{printf "%.1f", b/1048576}') MB"

echo "▸ 3/4  Subiendo…"
CREDS="$TMP/upload.json"
hostinger hosting files generate-upload-url \
  --username "$USERNAME" --domain "$DOMAIN" --format json > "$CREDS"

URL=$(python3 -c "import json;print(json.load(open('$CREDS'))['url'])")
AUTH=$(python3 -c "import json;print(json.load(open('$CREDS'))['auth_key'])")
REST=$(python3 -c "import json;print(json.load(open('$CREDS'))['rest_auth_key'])")

# TUS: crear el upload, luego enviar los bytes
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$URL/waya.zip?override=true" \
  -H "X-Auth: $AUTH" -H "X-Auth-Rest: $REST" -H "Tus-Resumable: 1.0.0" \
  -H "Upload-Length: $SIZE" -H "Upload-Offset: 0")
[ "$CODE" = "201" ] || { echo "✗ No se pudo crear la subida (HTTP $CODE)" >&2; exit 1; }

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$URL/waya.zip?override=true" \
  -H "X-Auth: $AUTH" -H "X-Auth-Rest: $REST" -H "Tus-Resumable: 1.0.0" \
  -H "Content-Type: application/offset+octet-stream" -H "Upload-Offset: 0" \
  --data-binary "@$ZIP")
[ "$CODE" = "204" ] || { echo "✗ Falló la subida de los bytes (HTTP $CODE)" >&2; exit 1; }

echo "▸ 4/4  Desplegando…"
hostinger hosting websites deploy-static-site-archive \
  "$USERNAME" "$DOMAIN" --archive-path waya.zip >/dev/null

sleep 10
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/")
if [ "$STATUS" = "200" ]; then
  echo "✓ Desplegado — https://$DOMAIN responde $STATUS"
else
  echo "⚠ Desplegado, pero https://$DOMAIN responde $STATUS (puede tardar unos segundos)"
fi
