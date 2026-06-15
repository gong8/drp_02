# Editable Google Slides export

`bethere-deck-pilot.pptx` is a **pilot**: 3 representative slides from the deck,
rebuilt as **native, editable PowerPoint shapes and text** (no rasterised
images), so they import into Google Slides fully editable.

- Slide 05 - "Plans dying is the norm" (stat cards)
- Slide 16 - "Then a blind moment" (phone-mockup walkthrough)
- Slide 24 - "Under the hood" (architecture diagram)

`preview/*.png` are local renders of those slides (the generator draws the same
layout model to both a `.pptx` and a `.png`, since there is no LibreOffice here
to render the pptx). They are QA artifacts, not the deliverable.

## Try it in Google Slides

1. Upload `bethere-deck-pilot.pptx` to Google Drive.
2. Right-click -> **Open with -> Google Slides** (or in Slides: **File ->
   Import slides**).
3. Check fidelity: fonts (Archivo / Inter / Space Mono are all Google Fonts, so
   they should render), the pink highlight blocks, the hard offset shadows
   (drawn as a duplicate ink rectangle behind each card), the phone mockup, and
   the architecture arrows. Everything is a real shape/text box you can edit.

If it looks right, the remaining 27 slides get built the same way.

## How it's built

`build_pptx.py` is a small dual-backend engine. Slides are authored at
1920x1080 px; the pptx slide is 13.333in x 7.5in (16:9), so 1 px = 6350 EMU and
font pt = px / 2. Text is measured with Pillow + the real font files so inline
pink highlight blocks land in the right place.

```bash
pip install python-pptx pillow
# fonts: Archivo, Inter, SpaceMono-{Regular,Bold} in /tmp/fonts (Google Fonts)
python3 build_pptx.py     # -> bethere-deck-pilot.pptx + preview/*.png
```

## Known approximations (to confirm before the full build)

- The 2 emotion-curve charts and the phone mockups are the densest slides;
  they are rebuilt as native shapes at ~90% fidelity, not pixel-identical.
- Background gradients and the slight sticker rotations import as editable
  Slides effects but may render a touch differently than the HTML.
