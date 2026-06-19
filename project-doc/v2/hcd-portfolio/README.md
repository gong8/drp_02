# HCD Techniques Portfolio (v2)

The DRP "Human Centred Design Techniques Portfolio" deliverable (80% of the 20%
Project Documentation block). **v2 is the merge candidate for final submission.**

It takes the team's hand-written content from `project-doc/human/DRP - HCD Portfolio
Human New.pdf` and sets it in the v1 refined-neobrutalist brand + build pipeline.

**19 A4-portrait pages.** Guiding principle (agreed with the team):

- **Human wording is verbatim** - "restructure, not reword". Text is re-presented in
  brand components (callouts, captions, cards) but never paraphrased.
- **Human assets throughout** - real persona photos, the hand-drawn stakeholder map,
  the hand-drawn -> digital build evolution, the journey maps, the "BeThere" cover.
- **v1 only adds** (scope = "Balanced"): the brand (`portfolio.css`) + build pipeline,
  plus the artifacts the human version was missing - a cover page, the Double Diamond
  + method table, the service blueprint / architecture page, the finding->change
  traceability table, a structured Impact section, and the reflection page (incl. the
  "intent not outcome, no SUS/adoption measured" integrity caveat).

## Files

- `portfolio.html` - the source of truth: one `<section class="page">` per page.
- `portfolio.css` - the brand tokens/components (copied from v1; 2.5cm margins, body
  >=11pt, table text >=9pt - staff rule, do not change).
- `build.py` - renders `portfolio.html` -> `hcd-portfolio.pdf` with headless Chrome.
- `hcd-portfolio.pdf` - the deliverable (19 pages).
- `assets/` - `personas/`, `stakeholders/`, `journeys/`, `sketches/`, `screens/`,
  `impact/`, plus `architecture.png`.

## Assets

Human images were extracted from the human PDF with `pdfimages`; v1's cover
screenshots (`assets/screens/init-*.jpg`, `voting-pick.jpg`) and `architecture.png`
were reused for the two `[+v1]` pages that need them (cover, blueprint). The full
extraction map and page-by-page plan live in
`docs/superpowers/specs/2026-06-19-hcd-portfolio-v2-design.md`.

## Rebuild

```bash
python3 build.py   # needs Google Chrome (macOS path in build.py); needs the web at build time for Google Fonts
```

After any edit, confirm `pdfinfo hcd-portfolio.pdf | grep Pages` still reports the
expected count - each `<section class="page">` clips at one A4 side, so an overflow is
silent. Re-read the rendered PDF to check nothing is cut off at a page edge.

## Known items for the team (flagged, not changed)

- **"[University]" on the cover** (page 18) reads like an unfilled template field, but
  it is baked into the cover image - fix it in the source (Canva) asset if so.
- **Cover loneliness stats** (92%, 22% / "tripled from 7%") are uncited and baked into
  the image. The one editable claim ("70% less time") is cited to the US Surgeon
  General (2023) on the stakeholder page. The loneliness framing appears on pages 5,
  17 and 18 with slightly different figures - reconcile if a marker might compare them.
- **Vasanth's persona photo** is AI-generated (a faint corner mark exists in the
  source); the crop on page 3 keeps it out of frame.

## Conventions

- No em dashes anywhere (use hyphens).
- Human text verbatim; never reword. Style from `portfolio.css` tokens/classes.
