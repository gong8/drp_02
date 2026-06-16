# BeThere - Final Presentation (reformat)

This is the team's human-made final deck (`presentation/human/DRP - Final
Presentation (2).pdf`), reproduced slide-for-slide but **re-styled in the
refined-neobrutalist BeThere brand** used by `presentation/v0/`. Same content
and sequence (50 slides); v0's visual language (Archivo / Inter / Space Mono,
ink borders, hard zero-blur shadows, the pink `.hl` highlight, paper / blush /
ink canvases).

## Files

```
index.html        the deck: one <section> per slide + the runtime (bottom <script>)
styles.css        :root brand tokens + component classes + viewer chrome (from v0)
bethere-reformat.pdf  the exported PDF (regenerate after edits)
export-pdf.sh     headless-Chrome PDF export (faithful: same engine, fonts embedded)
assets/
  personas/       persona + interview photos (Vasanth, Milly, Eddie, Chloe, Luca)
  sketches/       moment-if-sheet.png (the hand-drawn conditional-RSVP sketch)
  screens/        app screenshots + Trello / Linear, extracted from the human PDF
_frags/           per-section source fragments used to assemble index.html (build only)
```

## Present / navigate

Open `index.html` in a browser. Arrow keys / click to move, `N` for speaker
notes, `F` fullscreen, `1-9` to jump, `R` to restart.

## Re-export the PDF

```bash
./export-pdf.sh                 # -> bethere-reformat.pdf
./export-pdf.sh out.pdf         # custom path
```

## Rebuild from fragments

`index.html` is assembled from `_frags/_head.html`, `_frags/a.html` .. `e.html`,
and `_frags/_tail.html` (in that order). Edit a fragment, then re-concatenate:

```bash
cat _frags/_head.html _frags/a.html _frags/b.html _frags/c.html \
    _frags/d.html _frags/e.html _frags/_tail.html > index.html
```

## Conventions (inherited from the v0 brand)

- **No em dashes** anywhere - use hyphens.
- Style with the `:root` tokens + component classes in `styles.css`; never paste
  a raw hex into a slide.
- Fonts are Archivo / Inter / Space Mono (Google Fonts, loaded via `<link>`).
- Refined neobrutalism: flat colour, ink borders, hard offset shadows, square
  corners. No gradients inside components, no AI faces.
