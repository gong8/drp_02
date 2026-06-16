# BeThere - DRP Final Presentation (v3)

`index.html` is the **final presentation deck** (41 slides, 16:9, BeThere
neobrutalist brand). No build step, no dependencies - open it in any modern
browser. Styling lives in `styles.css` (`:root` brand tokens + component
classes); each slide is one `<section>` authored at 1920x1080, scaled to fit by
a small vanilla runtime that handles navigation, the build animation, and
speaker notes.

**What v3 is.** A merge of the two prior decks: it keeps **v2's animated
engine and visual language** (the `.frag` build, the per-segment journey curves,
the architecture spotlight) and folds in the **team's human deck**
(`presentation/reformat/`) for the persona/problem framing, the four
research-driven **user stories** (suggest, conditional, onboarding, cross-group)
each with their design-iteration + feedback slides, and the whole
post-architecture **evaluation / impact / looking-ahead** section. The static
walkthrough slides were replaced by **two live demos** (the core flow, and
no-download joining). Survey figures are the team's official numbers (**n=47**:
87% send a maybe/delay, 60% time-moves, 50%+ never leave the chat).

**The build animation.** Any element with class `.frag` starts hidden and
reveals one step per Right-arrow press (reveal order = DOM order), then advances
to the next slide. `@media print` forces every `.frag` visible, so the exported
PDF is always the fully-built state. The journey curves draw per-segment via
`<path class="curve-seg">`; the survey bars use `.frag--bar`; the architecture
slide is driven by `data-focus-steps="client api db shared ship"` (step 0 = the
clean overview the PDF prints). The "before vs after" slide overlays the faded
"group chat" decline curve under the rising BeThere curve. Read `../CLAUDE.md`
for the token/class system and the re-export workflow before editing.

## Present it

Open `index.html`, press **F** for fullscreen, and drive it from the keyboard.

| Key | Action |
| --- | --- |
| `->` / `Space` / `PageDown` | reveal the next build step, or advance to the next slide |
| `<-` / `PageUp` | step the build back, or go to the previous slide (fully built) |
| `Home` / `End` | first / last slide |
| `1`-`9` | jump to slide N |
| `R` | back to slide 1 |
| `N` | toggle the speaker-notes drawer |
| `F` | toggle fullscreen |

The URL tracks both slide and step (`#23` or `#23.6` = slide 23, step 6), so you
can refresh, deep-link to a mid-build state, or screenshot any exact step.

## How it is assembled

`index.html` is the canonical artifact, but it is concatenated from ordered
fragments under `_build/` (head + six section files + tail). To rebuild after
editing a fragment:

```bash
cat _build/_head.html _build/01-intro.html _build/02-research.html \
    _build/03-stats.html _build/04-opportunity-stories.html \
    _build/05-arch.html _build/06-eval.html _build/_tail.html > index.html
```

Editing `index.html` directly is fine too - just keep `_build/` in sync if you
rely on it.

## Export the PDF

`bethere-deck.pdf` is the submission PDF: **41 pages**, one slide each, 16:9
(1440 x 810 pt), web fonts embedded, every slide fully built. Regenerate after
any edit:

```bash
./export-pdf.sh            # uses your installed Chrome/Brave/Edge/Chromium
```

## Before you present

1. **The persona / interview photos are committed** (slides 2, 5 personas;
   9-11 interviews; 36 the impact group photo). Swap any for licensed, non-AI
   photos if the team prefers, then re-export.
2. **Verify the third-party statistics**: loneliness slide 13 (US Surgeon
   General 2023, BBC Loneliness Experiment 2018, ONS 2025) and the survey
   figures on slides 14-15 (n=47).
3. **The two live demos** (slides 22 and 27) are driven on real phones - the
   core flow (send -> vote -> blind moment -> clear, anonymity explained inline)
   and no-download joining. The Luca clip (slide 26) is a short video.
