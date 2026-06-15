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

Print to PDF (Chrome recommended): **File -> Print -> Save as PDF**, paper size
set to landscape / 16:9, margins **None**, and enable **Background graphics**.
The print stylesheet lays out one slide per page at the authored 1920x1080.
