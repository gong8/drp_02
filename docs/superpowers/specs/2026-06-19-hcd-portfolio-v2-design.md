# HCD Portfolio v2 - design + build plan

**Date:** 2026-06-19
**Deliverable:** HCD Techniques Portfolio (80% of the 20% Project Documentation block). Final submission candidate.
**Output:** `project-doc/v2/hcd-portfolio/` (new), built to `hcd-portfolio.pdf`.

## Goal

Merge the team's **carefully written human version** (`project-doc/human/DRP - HCD Portfolio Human New.pdf`, 18pp, Google-Docs styling) with the **formatting + a few rubric artifacts** of the **v1 Claude version** (`project-doc/v1/hcd-portfolio/`, 12pp, refined-neobrutalist brand).

## Principle (locked with the user)

- **Human wording is verbatim.** Never reword the team's text. Punctuation only: normalize any em dashes to hyphens (repo house rule), keep their numbers/quotes as written.
- **Restructure, not reword.** Free to re-present human text in v1 components - pull a line into a callout, push a paragraph under an image as a caption, break walls of text into cards - as long as the words are unchanged.
- **Human assets throughout** (real persona photos, hand-drawn stakeholder map, hand-drawn + digital mockup evolution, journey maps, the "BeThere" cover).
- **v1 only adds** (scope = **Balanced**): v1 contributes its brand (`portfolio.css`) + build pipeline + a small set of artifacts the human version is genuinely *missing*. v1 never replaces human content. v1's *re-presentations* of content the human already has (SVG journey maps, stat-card strips, clean stakeholder rings) are **out of scope** (those were "Maximal").

## Page structure (~17 pages; rubric target 15-20)

Tags: `[H]` human verbatim · `[+v1]` additively added (gap-filler) · `[H+v1]` human content in a v1 component.

**Cover**
1. `[+v1]` Cover - "How we designed BeThere" + app screenshots (v1 `assets/screens/`).
2. `[+v1]` How we ran the research - Double Diamond SVG + method table + Lukas reflection.

**People** (rubric: personas+empathy / stakeholder groups)
3. `[H]` Vasanth - photo + facts + full organiser narrative.
4. `[H]` Milly - photo + facts + full participant narrative.
5. `[H]` Stakeholders - hand-drawn concentric map + stakeholder/wider-impact text.

**Current / Future state** (rubric: current via methods / insights / opportunity)
6. `[H]` Journey maps: before - pub-quiz scenario + Vasanth's & Milly's maps (human raster).
7. `[H]` What the research told us - interview quotes + survey numbers (87% / "more than a third" / 60%) + group-chat death spiral.
8. `[H]` Future experience + Opportunity - preferred future + Vasanth's new journey + HMW as a callout.
9. `[+v1]` Service blueprint - system architecture diagram + privacy promises.

**Testing & validation** (rubric: feedback->richer experience / authentic build evolution / what drove changes)
10. `[H]` Our methodology - usability-testing approach.
11-12. `[H]` Suggesting a meetup - hand-drawn -> digital evolution + iteration narrative/quotes.
13. `[H]` Conditional attendance - hand-drawn -> digital evolution + iteration narrative/quotes.
14. `[+v1]` From finding to change - traceability table, as a capstone summary after the human narratives.

**Impact** (rubric: better outcome for target audience / all stakeholder groups)
15. `[+v1]` Impact - Vasanth/Milly before->after + bounded wider-impact + stakeholder cards + Felicity quote. (Fills the near-empty human Impact section.)
16. `[H]` Impact asset - the "get the whole group to BeThere" cover.

**Reflection**
17. `[+v1]` What HCD did to the product - deleted/promoted/left-open + open work + the honest "intent not outcome / no SUS/adoption measured" caveat + closing reflection.

## Asset extraction map (`pdfimages` from the human PDF -> `v2/assets/`)

| idx | dims | page | becomes |
|----|------|------|---------|
| 000 | 2500x1364 | 1 | `personas/vasanth.jpg` |
| 001 | 1402x1122 | 2 | `personas/milly.jpg` |
| 002 | 1386x1382 | 3 | `stakeholders/map.png` (hand-drawn) |
| 003 | 1441x727 | 5 | `journeys/vasanth-before.png` |
| 004 | 1436x707 | 6 | `journeys/milly-before.png` |
| 005 | 1407x682 | 7 | `journeys/vasanth-after.png` |
| 007 | 910x1494 | 9 | `sketches/suggest.png` (hand-drawn) |
| 006/008 | 478x941 | 9/10 | `screens/suggest-form.png` |
| 009 | 1067x520 | 10 | `screens/float-wizard.png` (4-up strip) |
| 010 | 1082x637 | 11 | `screens/create-flow.png` (3-up strip) |
| 011 | 818x1256 | 13 | `sketches/conditional-1.png` |
| 012 | 1044x1542 | 14 | `sketches/conditional-2.png` (AND/OR) |
| 013 | 934x1396 | 14 | `sketches/conditional-3.png` (at-least-one/all) |
| 014 | 475x939 | 15 | `screens/are-you-in.png` |
| 015(+016 smask) | 942x2048 | 15 | `screens/go-if.png` (BeReal-style; composite alpha) |
| 017 | 1395x2048 | 18 | `impact/cover.png` |

Copied from v1: `assets/screens/{init-suggest,voting-pick,init-dashboard}.jpg` (cover only) + `assets/architecture.png` (blueprint).

## Integrity handling
- Journey maps: human raster (Balanced). v1 SVG upgrade available on request.
- "[University]" on the cover: baked into the cover image; use as-is, flag for the team to fix in source.
- Loneliness stats: human numbers verbatim; add a citation only where v1 already has one (70% less time -> US Surgeon General, 2023). Cover-baked stats (92%, 22%) can only be flagged.
- Add the "intent not outcome, no SUS/adoption measured" caveat on the reflection page.

## Build pipeline
1. `mkdir -p project-doc/v2/hcd-portfolio/assets/{personas,stakeholders,journeys,sketches,screens,impact}`.
2. `cp` v1 `portfolio.css`, `build.py`; copy the v1 cover screens + `architecture.png`.
3. `pdftotext -layout` the human PDF -> verbatim source text.
4. `pdfimages -png` (+ handle smask for `go-if`) -> extract, rename per the map above.
5. Author `portfolio.html` (one `<section class="page">` per page) reusing v1's component classes.
6. `python3 build.py` -> `hcd-portfolio.pdf`.
7. Write a short `README.md`.

## Verification checklist
- `pdfinfo hcd-portfolio.pdf` reports **Pages <= 20** (no stray overflow pages).
- No content clipped at page edges (visual read of the rendered PDF).
- Margins 2.5cm, body >=11pt, table text >=9pt (inherited from v1 css - do not change).
- **No em dashes** anywhere (`grep` the html).
- Every human text block present and verbatim; every human asset placed in its correct narrative slot.
- The 4 rubric areas are each clearly signposted (footer section tags).

## Out of scope
- The pitch leaflet and copyright/legal report (separate, teammate/other deliverables).
- v1's "The Gathering" cover (superseded by the human "BeThere" cover).
- Rewording, cutting, or paraphrasing any human text.
