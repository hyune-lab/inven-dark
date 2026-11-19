#!/bin/sh
# 배포용 압축 파일을 만든다: 확장에 필요한 파일만 담는다.
set -eu
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/inven-dark-v$VERSION.zip"
mkdir -p dist
rm -f "$OUT"
zip -qr "$OUT" manifest.json src icons LICENSE -x '.*'
echo "$OUT"
