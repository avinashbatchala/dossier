# Bundled fonts

All fonts are licensed under the SIL Open Font License 1.1; each folder has its `OFL.txt`.

| Folder | Family | Styles | Source file in [google/fonts](https://github.com/google/fonts) |
| --- | --- | --- | --- |
| `geist` | Geist | 400, 500, 600, 700 | `ofl/geist/Geist[wght].ttf` |
| `newsreader` | Newsreader | 400, 500, 600, 700; roman and italic | `ofl/newsreader/Newsreader[opsz,wght].ttf`, `Newsreader-Italic[opsz,wght].ttf` |
| `ibm-plex-sans` | IBM Plex Sans | 400, 500, 600, 700 | `ofl/ibmplexsans/IBMPlexSans[wdth,wght].ttf` |
| `ibm-plex-mono` | IBM Plex Mono | 400, 500, 600 | `ofl/ibmplexmono/IBMPlexMono-Regular.ttf`, `IBMPlexMono-Medium.ttf`, `IBMPlexMono-SemiBold.ttf` |
| `eb-garamond` | EB Garamond | 400, 500, 600, 700 | `ofl/ebgaramond/EBGaramond[wght].ttf` |
| `source-serif-4` | Source Serif 4 | 400, 500, 600, 700 | `ofl/sourceserif4/SourceSerif4[opsz,wght].ttf` |
| `lora` | Lora | 400, 500, 600, 700 | `ofl/lora/Lora[wght].ttf` |
| `libre-caslon-text` | Libre Caslon Text | 400, 500, 600, 700 | `ofl/librecaslontext/LibreCaslonText[wght].ttf` |
| `playfair-display` | Playfair Display | 400, 500, 600, 700 | `ofl/playfairdisplay/PlayfairDisplay[wght].ttf` |
| `fraunces` | Fraunces | 400, 500, 600, 700 | `ofl/fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf` |
| `inter` | Inter | 400, 500, 600, 700 | `ofl/inter/Inter[opsz,wght].ttf` |
| `manrope` | Manrope | 400, 500, 600, 700 | `ofl/manrope/Manrope[wght].ttf` |
| `work-sans` | Work Sans | 400, 500, 600, 700 | `ofl/worksans/WorkSans[wght].ttf` |
| `space-grotesk` | Space Grotesk | 400, 500, 600, 700 | `ofl/spacegrotesk/SpaceGrotesk[wght].ttf` |
| `jetbrains-mono` | JetBrains Mono | 400, 500, 600, 700 | `ofl/jetbrainsmono/JetBrainsMono[wght].ttf` |
| `ibm-plex-sans-arabic` | IBM Plex Sans Arabic | 400, 500, 600 | `ofl/ibmplexsansarabic/IBMPlexSansArabic-{Regular,Medium,SemiBold}.ttf` |
| `ibm-plex-sans-devanagari` | IBM Plex Sans Devanagari | 400, 500, 600 | `ofl/ibmplexsansdevanagari/IBMPlexSansDevanagari-{Regular,Medium,SemiBold}.ttf` |
| `ibm-plex-sans-jp` | IBM Plex Sans JP | 400, 500, 600 | `ofl/ibmplexsansjp/IBMPlexSansJP-{Regular,Medium,SemiBold}.ttf` |
| `ibm-plex-sans-kr` | IBM Plex Sans KR | 400, 500, 600 | `ofl/ibmplexsanskr/IBMPlexSansKR-{Regular,Medium,SemiBold}.ttf` |
| `noto-sans-sc` | Noto Sans SC | 400, 600, GB 2312 subset | `ofl/notosanssc/NotoSansSC[wght].ttf` |
| `caveat` | Caveat | 500, Latin subset | `ofl/caveat/Caveat[wght].ttf` |

The first five were downloaded on 27 September 2026, the script fonts on 28 September 2026, the theme fonts from Source Serif 4 to JetBrains Mono on 3 October 2026, IBM Plex Mono SemiBold on 4 November 2026, and Caveat on 18 November 2026. They keep every script the originals cover (the OFL allows this without renaming fonts with a Reserved Font Name such as Plex). The exceptions are Noto Sans SC, below, and Caveat.

Caveat is only for the dashboard's daily note, never a document (it replaced Kalam in 1.15, #523). It's the variable font pinned at weight 500, then its Cyrillic left out: the file keeps Basic Latin, Latin-1, Latin Extended-A and general punctuation (54 KB instead of 404 KB), made with `fontTools.subset --unicodes="U+0000-017F,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215" --layout-features='*' --flavor=woff2`.

## Static faces, not variable fonts

Most of these are variable fonts at Google Fonts, and until 1.12.0 Dossier shipped them that way. Chromium's PDF printer can't embed a variable font: it draws each glyph as a Type 3 outline instead, with the font switched glyph by glyph, and while browsers show that fine, other viewers and the parsers behind job portals read it wrongly (text pasted backwards, letters in the wrong case; public issues 64 and 67). A face that Chromium has to embolden ends up as Type 3 too, which is why Plex Mono has a real SemiBold. So each family is shipped as static instances at the weights documents use, 400 to 700, with every other axis (optical size, width, Fraunces's softness) at its default, made with [fontTools](https://fonttools.readthedocs.io) from the variable TTF:

```bash
docker run --rm -v "$PWD":/fonts python:3.13-slim sh -c 'pip install -q fonttools brotli && python - <<EOF
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
for weight, style in [(400, "Regular"), (500, "Medium"), (600, "SemiBold"), (700, "Bold")]:
    font = TTFont("/fonts/Geist[wght].ttf")
    pin = {axis.axisTag: (weight if axis.axisTag == "wght" else axis.defaultValue) for axis in font["fvar"].axes}
    instance = instancer.instantiateVariableFont(font, pin, updateFontNames=True)
    instance.flavor = "woff2"
    instance.save(f"/fonts/Geist-{style}.woff2")
EOF'
```

(`updateFontNames` needs a STAT table; for a font without one, leave it out and the instance keeps the family's names.) A static TTF such as Plex Mono's is converted as it is:

```bash
docker/bin/yarn dlx -p wawoff2 woff2_compress.js Font.ttf Font.woff2
```

Then load it in `index.ts` with `next/font/local`, one `src` entry per weight. `e2e/themes.spec.ts` prints every built-in theme and fails on a Type 3 font, so a variable font or a synthesised weight can't slip back in.

## Fonts for other scripts

Documents can be written in Greek, Arabic, Persian, Hindi, Chinese, Japanese and Korean (PRD SET-7), which the theme fonts don't cover (E5-8). `index.ts` loads a fallback face for each script, limited with `unicode-range` to that script's characters, and every document font stack lists them before the theme font (`resolveTheme` in `src/lib/themes.ts`, `--script-fonts` in `src/components/documents/document.module.css`). Latin text skips them, a browser downloads one only for text that needs it, and PDFs never fall back to whatever fonts the server has.

- **Greek:** EB Garamond for serif themes and IBM Plex Sans for the others, loaded a second time with a Greek-only range. Next.js emits those two files twice (0.5 MB); the Greek face has to come before the theme font, because Geist has a handful of Greek letters and would otherwise mix two styles.
- **Arabic and Persian:** IBM Plex Sans Arabic. **Hindi:** IBM Plex Sans Devanagari.
- **Chinese, Japanese, Korean:** Noto Sans SC, IBM Plex Sans JP and IBM Plex Sans KR. Chinese and Japanese share Han characters, so the document's `lang` decides which font draws them first.

Together they add about 8 MB to the image: JP 3.4 MB, Noto Sans SC 2.2 MB, KR 1.8 MB, the Greek copies 0.9 MB, Devanagari 0.3 MB and Arabic 0.2 MB (all bundled fonts: 11 MB in `.next/static/media`). A browser only downloads the ones a document needs.

### Noto Sans SC subset

The full variable font is 7.8 MB as WOFF2. It's cut down to the 6,763 hanzi and the symbols of GB 2312 (the common simplified Chinese set), plus CJK punctuation and full-width forms, and instanced at the two weights documents need, 400 and 600 (500 falls back to 400, and 700 to 600, without emboldening): 1.0 and 1.1 MB. The OFL allows this; its Reserved Font Name is "Source", not "Noto". To rebuild them from the original TTF:

```bash
docker run --rm -v "$PWD":/fonts python:3.13-slim sh -c 'pip install -q fonttools brotli && python - <<EOF
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
chars = set()
for hi in range(0xA1, 0xF8):
    for lo in range(0xA1, 0xFF):
        try:
            chars.update(bytes([hi, lo]).decode("gb2312"))
        except UnicodeDecodeError:
            pass
unicodes = {ord(c) for c in chars} | set(range(0x3000, 0x3040)) | set(range(0xFF00, 0xFFF0))
font = TTFont("/fonts/NotoSansSC[wght].ttf", lazy=False)
options = subset.Options()
options.layout_features = ["*"]
subsetter = subset.Subsetter(options)
subsetter.populate(unicodes=unicodes)
subsetter.subset(font)
for weight, style in [(400, "Regular"), (600, "SemiBold")]:
    instance = instancer.instantiateVariableFont(font, {"wght": weight}, inplace=False)
    instance.flavor = "woff2"
    instance.save(f"/fonts/NotoSansSC-{style}.woff2")
EOF'
```

Subset first and instance second: the other order fails in fontTools.
