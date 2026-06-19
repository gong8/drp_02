# HCD Portfolio v1 - Design Spec

Date: 2026-06-18
Owner: Gong (Team DRP_02)
Status: proposed (awaiting review)

## Context

The DRP "Project Documentation" block (20% of the final grade) has three deliverables; the
**Human Centred Design Techniques Portfolio is 80% of that block** - by far the most important
of the three. The legal report v1 is done (plain, one A4) and teammates own the pitch leaflet.
This spec covers a **full v1 rework** of the HCD portfolio only.

A strong v0 exists at `project-doc/v0/hcd-portfolio/` (413-line markdown injected into a brand
HTML template, rendered to PDF; 8 sections, evidence-grounded, rated strong). The content is
good; this rework is about **presentation + structure**, re-homing the content into a clean,
deck-tight v1 and finishing the two open asset gaps.

## Goal

An engaging, visual, brand-tight HCD portfolio PDF that scores top-band on the rubric's four
areas (People; Current/Future State; Testing & Validation; Understanding Impact) plus reflection,
built from the team's real research with no fabricated data.

## Decisions (locked with the user)

- **Visual direction:** the BeThere **refined-neobrutalist brand**, used **clean and minimal**,
  **tight to the `presentation/v4` deck** (Archivo / Inter / Space Mono; ink + pink `#ff5ca8` +
  green + purple palette; hard zero-blur offset shadows; ink borders; zero border-radius; the
  pink `.hl` highlight block as the one signature accent). No AI-generated faces. **No filler
  chrome** - no decorative eyebrows, page-number badges, or redundant sub-labels. Whitespace and
  restraint; accents used purposefully, once each. (Validated via a portrait mockup the user
  approved.)
- **Format:** **A4 portrait** pages.
- **Granularity:** **comprehensive, ~11 pages, one HCD technique per page.**
- **Content base:** elevate the v0 content (reuse its evidence, quotes, DRP refs); do not rewrite
  from scratch and do not invent metrics.

## Page sequence (~11 A4 portrait pages)

| # | Page | Content | Rubric area |
|---|------|---------|-------------|
| 1 | Cover | Title, team (Team DRP_02, Imperial x RCA), the problem in one line | - |
| 2 | Process & methods | Double Diamond x milestones; methods table (survey n=43 + 3 interview rounds); testing-plan canvas | (approach) |
| 3 | Personas | The 4 grounded personas (Luca / Matthew / Ghost / Tom) + real-photo slots | People |
| 4 | Stakeholder map | The stakeholder ring map (core / direct / indirect) | People |
| 5 | Discover | AEIOU lens + survey insights + the HMW statement | Current state |
| 6 | Journey maps | Current "plan that dies" vs future-on-BeThere, emotion-mapped (before/after) | Future state |
| 7 | Service blueprint | Frontstage / screens / backstage tRPC / Postgres data, with the privacy boundary marked | Future state |
| 8 | Prototyping ladder | Hand-drawn -> walking skeleton -> live builds; built-app screenshots | Testing & Validation |
| 9 | Finding -> change matrix | Evidence (quote / survey figure) -> insight -> change shipped (DRP refs) | Testing & Validation |
| 10 | Impact | Per-persona impact + the speculative cover story | Understanding Impact |
| 11 | Reflection | The concentrated written discussion: what HCD did to the product, honest tensions | reflection |

**Discussion-cap handling.** The brief caps the *discussion* at one A4 side but lets *evidence /
support material* run as long as needed and encourages diagrams. So pages 2-10 are
**evidence-led** (diagram + tight caption, minimal prose) and **page 11 carries the concentrated
written discussion** (kept to ~one side). This keeps us defensibly within the rubric's length rule
while showing rich visual evidence.

## Build approach

Mirror the proven patterns in `presentation/v4` and `project-doc/v1/copyright-legal-report`:

- New folder **`project-doc/v1/hcd-portfolio/`**.
- **`portfolio.html`** - one self-contained document; each page is a `<section class="page">`
  sized to A4 portrait, with `page-break-after` so each renders as its own PDF page. Google-Fonts
  `<link>` for Archivo / Inter / Space Mono (so they embed in the PDF).
- **`portfolio.css`** - the brand: copy the relevant `:root` tokens + component classes
  (`.card`, `.hl`, `.chip`, `.sticker`, `.eyebrow`-equivalents, shadows) from
  `presentation/v4/styles.css` so the portfolio is self-contained and on-brand (no runtime path
  dependency on `presentation/`). `@page { size: A4 portrait; margin: 0 }`; page padding in CSS.
- **`build.py`** - headless-Chrome `--print-to-pdf` (same invocation as v0/legal build.py) ->
  `hcd-portfolio.pdf`. Verify page count and visually check each page.
- Diagrams (journey curve, double diamond, stakeholder rings, service blueprint, finding->change)
  are **hand-built HTML/CSS/SVG** in the brand, not mermaid - so they match the deck exactly and
  print cleanly.
- Images use an `image-slot`-style placeholder (like the deck) where a real asset is required.

## Asset gaps (team to supply real files)

- **Persona photos** (page 3) - real licensed stock photos of people of roughly the right age,
  never AI-generated faces. Placeholder slots until supplied.
- **Built-app screenshots** (page 8) - three live-app screens (create wizard; collecting
  EventDetail with public vote counts and no names; a cleared "You're in" moment). Placeholder
  slots until supplied.

## Conventions

- No em dashes anywhere (use hyphens).
- Brand tokens / classes, never raw inline hex (per `presentation/CLAUDE.md`).
- No AI faces. Flat colour, ink borders, hard offset shadows; no soft shadows or gradients inside
  components (gradients only on page backgrounds, used sparingly).
- All research figures/quotes cite real primary research; where a value was never measured, mark
  it `[TEAM TO FILL]` rather than invent it (same integrity rule as v0 / the M4 docs).

## Out of scope

- The pitch leaflet and the copyright/legal report (teammate-owned / already done).
- Changing the live app or the deck.

## Verification

- `python3 build.py` produces `hcd-portfolio.pdf`; confirm ~11 pages, each a clean A4 portrait
  side with nothing clipped (render + visual review, page by page).
- Walk the rubric: every one of the four areas + reflection is visibly covered by its page(s).
- `grep` the final text for em dashes (none); spot-check that every quote / figure / DRP ref
  matches v0 / the research corpus.
- Brand fidelity: fonts embedded, palette = deck tokens, no AI faces, no filler chrome.
