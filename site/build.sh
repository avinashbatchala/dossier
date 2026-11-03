#!/bin/sh
# Builds the website into _site/ (or the folder given): the pages in site/,
# plus the screenshots, icons and fonts the README and the app already have,
# so there's one copy of each in the repository.
set -eu

cd "$(dirname "$0")/.."
out=${1:-_site}

rm -rf "$out"
mkdir -p "$out/images" "$out/fonts"
cp site/index.html site/style.css site/main.js site/og.png "$out/"
cp .github/images/*.png .github/images/demo.gif "$out/images/"
cp src/app/icon.svg src/app/favicon.ico src/app/apple-icon.png "$out/"
cp src/fonts/newsreader/*.woff2 src/fonts/geist/*.woff2 src/fonts/jetbrains-mono/*.woff2 "$out/fonts/"
for font in newsreader geist jetbrains-mono; do
  cp "src/fonts/$font/OFL.txt" "$out/fonts/OFL-$font.txt"
done
