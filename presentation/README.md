# BeThere - DRP Final Presentation

`index.html` is the **final presentation deck** (30 slides, 16:9, BeThere
neobrutalist brand). It is a single self-contained file - no build step, no
dependencies. Open it in any modern browser.

It was implemented from a Claude Design handoff bundle: the slide markup is
carried over verbatim (authored at 1920x1080) and wrapped in a small vanilla
runtime that scales each slide to fit the screen and handles navigation +
speaker notes. The original architecture mock lives alongside in
`architecture-slides.html`; the brand spec is `bethere-design-language-prompt.txt`.

## Present it

Open `index.html`, press **F** for fullscreen, and drive it from the keyboard.

| Key | Action |
| --- | --- |
| `->` / `Space` / `PageDown` | next slide |
| `<-` / `PageUp` | previous slide |
| `Home` / `End` | first / last slide |
| `1`-`9` | jump to slide N |
| `R` | back to slide 1 |
| `N` | toggle the speaker-notes drawer |
| `F` | toggle fullscreen |

You can also click the left/right half of a slide to move, or use the control
bar at the bottom (it auto-hides while you present). The URL updates with the
slide number (`#14`), so you can refresh or deep-link to a slide. Every slide
carries a full conversational speaker script - open the notes drawer to rehearse.

## Before you present - two actions

1. **Drop a real photo into Millie's persona slot (slide 8).** It is an empty
   drag-and-drop slot on purpose - drop a *licensed stock photo* of a ~22yo
   student (NOT an AI-generated face, per the department's warning). The photo
   is saved in your browser's local storage and survives reloads; hover and
   click the `x` to clear it.
2. **Verify the third-party statistics on slide 3** (US Surgeon General 2023,
   BBC Loneliness Experiment, ONS 2025) before presenting them.

The "play live" clip slot on slide 7 ("Real voices") is a placeholder for a
15-20s interview excerpt - wire it to the real clip or play it from a second
device during the talk.

## Export a PDF (for the Scientia submission)

`bethere-deck.pdf` is the submission PDF: 30 pages, one slide each, 16:9
(1440 x 810 pt), web fonts embedded, fully vector. It is rendered by a headless
Chromium - the same engine that draws `index.html` - so it is pixel-identical to
the live deck (far more faithful than a PowerPoint/Slides export, which
substitutes fonts).

Regenerate it after any edit:

```bash
./export-pdf.sh            # uses your installed Chrome/Brave/Edge/Chromium
```

No-tooling fallback: open `index.html` in Chrome, **File -> Print -> Save as
PDF**, with **Background graphics ON**, **Margins: None**, and paper size set to
the slide. The print stylesheet already lays out one slide per page at
1920x1080.

> We tried an editable PowerPoint/Google Slides export too, but a `.pptx` only
> renders the brand fonts in *Google* Slides (they are Google Fonts); desktop
> PowerPoint substitutes them and the heavy Archivo titles look wrong. Since the
> deliverable is a PDF, the HTML -> PDF path above is the faithful one. (The
> abandoned pptx generator is in git history if ever needed.)
