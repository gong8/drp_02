#!/usr/bin/env python3
"""Re-render assets/architecture.png from the deck's #arch-base diagram.

The committed architecture.png was exported with the web fonts NOT loaded, so
Archivo/Inter fell back to a serif - clashing with the rest of the portfolio.
This script extracts the exact diagram markup + the logo sprite from
presentation/v4/index.html, renders it standalone with the Google Fonts link
(headless Chrome, font-load wait), on a transparent background, then autocrops
to a crisp PNG. The diagram content/layout is unchanged - only the fonts render
correctly now. Run: python3 render-architecture.py"""
import os, re, subprocess
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DECK = os.path.join(REPO, "presentation", "v4")
DECK_HTML = os.path.join(DECK, "index.html")
DECK_CSS = os.path.join(DECK, "styles.css")
OUT = os.path.join(HERE, "assets", "architecture.png")
TMP_HTML = os.path.join(HERE, "_arch-render.html")
TMP_PNG = os.path.join(HERE, "_arch-render.png")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

FONTS = ('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900'
         '&family=Inter:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap')

src = open(DECK_HTML, encoding="utf-8").read()

# 1) the hidden logo sprite: <svg aria-hidden ... > ... </svg>
m = re.search(r'(<svg aria-hidden="true".*?</svg>)', src, re.S)
sprite = m.group(1)

# 2) the architecture diagram, matched by div depth from <div class="arch-diagram">
start = src.index('<div class="arch-diagram">')
i, depth = start, 0
for tok in re.finditer(r'<div\b|</div>', src[start:]):
    if tok.group(0) == '</div>':
        depth -= 1
        if depth == 0:
            i = start + tok.end()
            break
    else:
        depth += 1
diagram = src[start:i]

html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="{FONTS}" rel="stylesheet">
<link rel="stylesheet" href="file://{DECK_CSS}">
<style>
  html,body{{margin:0;padding:0;background:transparent;}}
  .wrap{{width:1740px;padding:6px;}}
</style></head><body>
{sprite}
<div class="arch"><div class="wrap">{diagram}</div></div>
</body></html>"""
open(TMP_HTML, "w", encoding="utf-8").write(html)

# 3) headless screenshot, transparent bg, high DPI, with font-load wait
subprocess.run([
    CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--default-background-color=00000000", "--force-device-scale-factor=3",
    "--window-size=1760,940", "--virtual-time-budget=20000",
    "--run-all-compositor-stages-before-draw",
    f"--screenshot={TMP_PNG}", "file://" + TMP_HTML,
], check=True, stderr=subprocess.DEVNULL)

# 4) autocrop transparent margins, then flatten onto the page paper colour.
#    (An opaque PNG matching --paper composites seamlessly; a transparent one
#    gets rendered against black by Chrome's print-to-pdf.)
PAPER = (253, 246, 238)  # portfolio.css --paper #fdf6ee
im = Image.open(TMP_PNG).convert("RGBA")
im = im.crop(im.getbbox())
flat = Image.new("RGBA", im.size, PAPER + (255,))
flat = Image.alpha_composite(flat, im).convert("RGB")
flat.save(OUT)
print(f"  wrote {OUT}  {flat.size[0]}x{flat.size[1]}")

os.remove(TMP_HTML)
os.remove(TMP_PNG)
