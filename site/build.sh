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

# The Docker image's download count goes into the page here, so visitors'
# browsers don't ask anyone for it. Only the package page shows it (GitHub's
# API has no download counts for ghcr.io), as <h3 title="12741">12.7K</h3> under
# "Total downloads". If that can't be read, the page keeps the floor it has.
package=https://github.com/AienTech/dossier/pkgs/container/dossier
downloads=$(curl -fsSL --max-time 20 "$package" 2>/dev/null |
  grep -A1 'Total downloads' | sed -n 's/.*title="\([0-9][0-9]*\)".*/\1/p' | head -n 1) || true
if [ -n "$downloads" ]; then
  # Rounded down, so it never says more than there were: 12741 is 12.7k.
  shown=$(awk -v n="$downloads" 'BEGIN {
    if (n >= 1000000) printf "%.1fM", int(n / 100000) / 10
    else if (n >= 1000) printf "%.1fk", int(n / 100) / 10
    else printf "%d", n
  }' | sed 's/\.0\([kM]\)$/\1/')
  sed "s|<b data-image-downloads>[^<]*</b>|<b data-image-downloads title=\"$downloads\">$shown</b>|" \
    site/index.html > "$out/index.html"
else
  echo "build.sh: couldn't read the image's download count from $package; the page keeps its floor" >&2
fi
