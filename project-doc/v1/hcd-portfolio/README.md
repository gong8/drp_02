# HCD Techniques Portfolio (v1)

The DRP "Human Centred Design Techniques Portfolio" deliverable (80% of the documentation
block), rebuilt for v1 as a clean, minimal, A4-portrait document in the BeThere
refined-neobrutalist brand (deck-tight: same tokens/components as `presentation/v4`).

11 pages: Cover, Process and methods, Personas, Stakeholder map, Discover, Journey maps,
Service blueprint, Prototyping ladder, Finding-to-change matrix, Impact, Reflection. The
written discussion is concentrated on the Reflection page; pages 2-10 are evidence-led
(diagram + tight caption), per the rubric's "discussion limited to one A4 side" rule.

## Files

- `portfolio.html` - the source of truth: one self-contained document, one `<section class="page">`
  per page. Edit this to change content.
- `portfolio.css` - the brand: tokens + component classes ported from `presentation/v4/styles.css`
  (Archivo / Inter / Space Mono; ink + pink palette; hard offset shadows; A4 print rules).
- `build.py` - renders `portfolio.html` to `hcd-portfolio.pdf` with headless Chrome.
- `hcd-portfolio.pdf` - the deliverable (11 A4 portrait pages).

## Rebuild

```bash
python3 build.py     # needs Google Chrome (macOS path hardcoded in build.py); also needs the web at build time for the Google Fonts
```

## Real assets the team must drop in (currently `.slot` placeholders)

- **Persona photos** (page 3) - real licensed stock photos of people of roughly the right age.
  Never AI-generated faces.
- **App screenshots** (page 8) - three live-app screens: the create wizard; the collecting
  EventDetail with public vote counts and no names; a cleared "You're in" moment.
- **Cover-story image** (page 10) - the speculative 2028 cover-story mock.

## Conventions

- No em dashes anywhere (use hyphens).
- Style from `portfolio.css` tokens/classes, never raw inline hex.
- Every quote / figure / DRP ref is real (sourced from `project-doc/v0/hcd-portfolio` and the
  research corpus); verified 2026-06-18. Do not invent metrics.
- Each page must stay within one A4 side. If an edit overflows, the PDF gains a stray page;
  tighten until `pdfinfo` reports `Pages: 11`.
