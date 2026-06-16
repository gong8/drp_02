# BeThere - DRP Final Presentation (v2)

`index.html` is the **final presentation deck** (38 slides, 16:9, BeThere
neobrutalist brand). No build step, no dependencies - open it in any modern
browser. Styling lives in `styles.css` (`:root` brand tokens + component
classes); each slide is one `<section>` authored at 1920x1080, scaled to fit by
a small vanilla runtime that handles navigation, the build animation, and
speaker notes.

**What's new in v2:** the deck is decluttered to the brand spec (no eyebrow
kickers, no Space-Mono corner badges, no decorative quote glyphs) and **every
slide animates** - pressing the right arrow reveals one piece at a time, then
advances to the next slide. The three journey curves draw segment by segment,
the survey bars grow from zero, and the architecture is a single slide whose
right-arrow spotlights each layer in turn.

**Editing the deck?** Read `../CLAUDE.md` first - it covers the token/class
system, the component vocabulary, and the re-export + fidelity-check workflow.

## Present it

Open `index.html`, press **F** for fullscreen, and drive it from the keyboard.

| Key | Action |
| --- | --- |
| `->` / `Space` / `PageDown` | reveal the next build step, or advance to the next slide |
| `<-` / `PageUp` | step the build back, or go to the previous slide (fully built) |
| `Home` / `End` | first / last slide |
| `1`-`9` | jump to slide N (at its start, ready to build) |
| `R` | back to slide 1 |
| `N` | toggle the speaker-notes drawer |
| `F` | toggle fullscreen |

You can also click the left/right half of a slide to step. The control bar shows
**step pips** for the current slide's build progress. The URL tracks both slide
and step (`#14` or `#14.3` = slide 14, step 3), so you can refresh, deep-link to
a mid-build state, or screenshot any exact step.

## The build animation

Any element with class `.frag` starts hidden and animates in when its step is
reached (reveal order = DOM order). The reveal uses the individual
`translate`/`scale` CSS properties so an element's own `transform` (e.g. a
tilted sticker) is preserved. Three points to remember:

- `@media print` forces every `.frag` visible, so the exported PDF is always the
  **fully-built** state of each slide.
- The journey curves animate via per-segment `<path class="curve-seg">` (drawn
  with `stroke-dashoffset`, normalized by `pathLength`); the survey bars use
  `.frag--bar` (grows from `width:0` to its `--w`).
- The architecture slide is driven by `data-focus-steps="client api db shared
  ship"` instead of `.frag` - each step sets `data-focus`, which CSS uses to
  spotlight one layer and show its caption. Step 0 is the clean overview, which
  is also what the PDF prints.

## Export a PDF (for the Scientia submission)

`bethere-deck.pdf` is the submission PDF: **38 pages**, one slide each, 16:9
(1440 x 810 pt), web fonts embedded, fully vector, every slide fully built. It
is rendered by a headless Chromium - the same engine that draws `index.html` -
so it is pixel-identical to the live deck.

Regenerate it after any edit:

```bash
./export-pdf.sh            # uses your installed Chrome/Brave/Edge/Chromium
```

No-tooling fallback: open `index.html` in Chrome, **File -> Print -> Save as
PDF**, with **Background graphics ON**, **Margins: None**, and paper size set to
the slide.

## Before you present

1. **The persona photos are committed** (slides 2 and 4 use
   `assets/personas/persona-vasanth.jpg` / `persona-milly.jpg`). Swap them for
   licensed, non-AI photos if the team prefers different faces, then re-export.
2. **Verify the third-party statistics on slide 10** (US Surgeon General 2023,
   BBC Loneliness Experiment, ONS 2025) before presenting them.
3. **The live demo** is meant to be woven through the walkthrough slides
   (17-21, Send -> Vote -> Moment -> Clear) on a real phone, not shown as a
   separate "Demo" slide.
