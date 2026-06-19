# HCD Techniques Portfolio (v2)

The DRP "Human Centred Design Techniques Portfolio" deliverable (80% of the 20%
Project Documentation block). **v2 is the merge candidate for final submission.**

It takes the team's hand-written content from `project-doc/human/DRP - HCD Portfolio
Human New.pdf` and sets it in the v1 refined-neobrutalist brand + build pipeline.

**18 A4-portrait pages.** Guiding principle (agreed with the team):

- **Human wording is verbatim** - "restructure, not reword". Text is re-presented in
  brand components (callouts, captions, cards) but never paraphrased.
- **Human assets throughout** - real persona photos, the hand-drawn stakeholder map,
  the hand-drawn -> digital build evolution, the journey maps, the "BeThere" cover.
- **v1 only adds**: the brand (`portfolio.css`) + build pipeline, plus the artifacts
  the human version was missing - a cover page, an AEIOU field-research page, the
  architecture page ("How the promises are kept"), a Testing Plan Canvas + a testing
  reflection on the methodology page, the finding->change traceability table, and an
  Impact evidence page.
- **Minimal chrome** (team steer): no kicker/eyebrow labels above headings, no page
  footers, no cover tagline. Just the heading + content per page.
- **Ends on the cover asset** = an Impact evidence page (per-stakeholder validated
  outcomes) leads into the team's cover-story asset, which closes the document
  full-bleed.

## Files

- `portfolio.html` - the source of truth: one `<section class="page">` per page.
- `portfolio.css` - the brand tokens/components (copied from v1; 2.5cm margins, body
  >=11pt, table text >=9pt - staff rule, do not change).
- `build.py` - renders `portfolio.html` -> `hcd-portfolio.pdf` with headless Chrome.
- `hcd-portfolio.pdf` - the deliverable (18 pages).
- `assets/` - `personas/`, `stakeholders/`, `journeys/`, `sketches/`, `screens/`,
  `impact/`, plus `architecture.png`.

## Assets

Human images were extracted from the human PDF with `pdfimages`; v1's
`architecture.png` was reused for the service-blueprint page. The full
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
  the image (which also contains an em dash in "end to end -"). The one editable claim
  ("70% less time") is cited to the US Surgeon General (2023) on the stakeholders page.
- **No explicit "we did not measure outcomes" caveat** remains in the document (it
  lived on the removed reflection page). The cover's forward-looking claims read as a
  speculative impact asset; add a one-line disclaimer if a marker might read them as
  measured results.
- **Vasanth's persona photo** is AI-generated (a faint corner mark exists in the
  source); the crop on page 3 keeps it out of frame.

## Conventions

- No em dashes anywhere (use hyphens).
- Human text verbatim; never reword. Style from `portfolio.css` tokens/classes.
