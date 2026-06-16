# Presentation v2: declutter + universal right-arrow build animation - 2026-06-16

**Branch:** dev | **PRs:** none (committed directly to dev, per repo convention for deck work) | **Linear:** DRP-72 (Done) | **Scope:** Rebuild the BeThere final-presentation deck in `presentation/v2/` - strip the "vibe-coded" chrome to brand spec, animate every slide so the right arrow reveals one piece at a time, and collapse the crowded architecture into one clean animated slide.

## TL;DR
The user asked to turn `presentation/v1/` (a working but "vibe-coded" HTML slide deck) into a cleaner `presentation/v2/`: cut decorative junk, de-crowd the architecture diagram, and make pressing the right arrow advance the build one piece at a time on EVERY slide (especially the persona journey curves). I built a universal `.frag` build engine into the deck's vanilla runtime, animated all 38 slides (journey curves draw segment-by-segment, survey bars grow, the architecture became a single slide whose right-arrow spotlights each layer), and stripped every eyebrow kicker / corner badge / decorative quote glyph / stray HTML comment - keeping all rubric content. The whole deck was verified by headless-Chrome screenshots (a `#N.S` deep-link makes any build step reproducible) and a 38-page fully-built PDF. Work shipped as 9 modular commits on `dev` (7f0fed0 -> 4d661ce); DRP-72 is marked Done. A late follow-up fixed slide-to-slide transitions to crossfade through white instead of the dark surround.

## What was done

### Context-gathering (before any edits)
- Read `presentation/CLAUDE.md` (deck edit conventions: token/class system, the architecture "spotlight tour", re-export workflow), `presentation/context/design-language-prompt.txt` (the brand bible: refined neobrutalism; **NO eyebrow/kicker lines**, **no monospace as decoration**, one idea per slide, semantic colour), and `presentation/_drafts/final-presentation-audit-2026-06-15.md` (the team's own multi-agent audit + the 24-row mark scheme; the recurring assessor demand is "persona-first, not a feature list").
- Discovered the **current v1 deck had already evolved past that audit**: it now leads persona-first (Vasanth slide 2, Milly slide 4, their "as they felt it" journey curves at 3 & 5), has real committed persona photos, and a freshly rebuilt "winner's data-flow" architecture (DRP-70). So the audit was authoritative for the *mark scheme* and *brand voice*, but its slide numbers were stale.
- Dispatched one `general-purpose` subagent to inventory all 38 v1 slides (per-slide purpose, cut-candidates, and a natural fragment/build plan each) and paste the runtime + arch-generator scripts verbatim. **Gotcha learned:** the subagent HTML-escaped its verbatim code paste (`&gt;` for `>`), so it was unusable as an exact-match `old_string` - I re-read the real bytes from disk for every edit.
- Rendered the v1 architecture overview + the 6-page spotlight tour + a montage of representative slides from `v1/bethere-deck.pdf` (via `pdftoppm` + ImageMagick `montage`) to see the crowding firsthand (~40 labelled elements at 13-17px on the arch).

### Three decisions locked with the user (AskUserQuestion)
1. **Architecture in the PDF** -> "One clean animated slide" (collapse the 6 cloned pages; PDF shows a single de-crowded overview).
2. **Cut depth** -> "Strip all of it to brand spec" (remove every eyebrow, corner badge, side-caption, quote glyph, HTML comment; keep all rubric content).
3. **Rollout** -> "Do the whole deck in one pass" (no exemplar checkpoint).

### The build engine (commit 7f0fed0)
- Scaffolded `v2/` from `v1/` (copied index.html, styles.css, export-pdf.sh, README.md, assets/, reference/).
- Added a universal intra-slide fragment system:
  - CSS: `.frag` starts hidden (`opacity:0; translate:0 22px`) and animates in on `.is-shown`. **Reveal uses the individual `translate`/`scale` CSS properties, NOT `transform`,** so an element's own `transform` (e.g. a tilted sticker's `rotate(-4deg)`) survives. Variants: `.frag--left/--right/--still/--pop/--rise-lg`. `@media print { .frag { opacity:1 !important; translate:none !important; scale:none !important } }` forces every fragment visible so the **PDF is always the fully-built state**.
  - Runtime (the bottom `<script>` IIFE): made `advance()`/`go()` step-aware so the existing keydown/click handlers needed no changes. Each slide precomputes `_frags` (its `.frag` descendants) and `_steps`. Right/Space/click-right reveals the next fragment; at the last step it advances to the next slide (step 0); Left reverses, landing on the prior slide fully built. Added a `#N` / `#N.S` deep-link (slide.step) - this both deep-links and **powers headless screenshot verification of any build step**. Added control-bar step pips (`#deck-steps`).
- Cleaned the cover (dropped the "Designing for Real People" eyebrow + the "DRP - GROUP 02" monospace chip; BeThere./tagline/credits now build) and smoke-tested the whole chain (live screenshots at #1, #1.1-1.3, plus a PDF export confirming page 1 prints fully-built).

### Slide animation + declutter, block by block (commits 58ab037 -> c051d16)
Worked positionally 1->38, doing whole-inner-body or targeted-anchor edits (never reproducing the long `data-speaker-notes`). Per block:
- **1-9 opening/persona (58ab037):** persona cards build; journey curves rebuilt; research/interview eyebrows + decorative 96px quote glyphs removed.
- **10-14 stats/HMW (a595c8a):** stat cards build; the survey chart's bars now **grow from zero** (`.frag--bar` animates `width:0 -> var(--w)`); archetype cards + stakeholder bands build; "Friend Meetup Survey" chip + "Opportunity - how might we" eyebrow removed.
- **15-21 build/demo (641cfc4):** dashboard phone slides in; story cards build; walkthrough caption stacks build while the phone stays put; the four "Walkthrough N/4" corner badges + the two demo eyebrows + "switch to the phone" badge removed.
- **22-29 iteration/eval (996de5c):** the inverted "you're in" curve animates; before/after iteration cards + connector arrows build; "One more user story" / "Live demonstration 2 of 2" eyebrows + "a fresh phone" badge + decorative quote glyph removed.
- **31-38 stack/eval/close (c051d16):** stack/group/eval cards + persona rows + bounded-claim banner build; "Future work" eyebrow + closing quote glyph removed.

### The three journey curves - signature animation (commit 58ab037 for 3 & 5, 996de5c for 22)
Converted each single `<polyline>` into 6 `<g class="frag frag--still">` point-groups. Each group (after the first) contains an incoming `<path class="curve-seg" pathLength="1">` segment that **draws via `stroke-dashoffset`** when the group is shown (the `pathLength="1"` trick normalizes every segment to a uniform draw), plus the node circle + Archivo title + Inter sub-label. So each right-arrow extends the line to the next emotional beat and pops the node, ending on the pink "Gives up"/"Stays home" (descending) or green "You're in" (ascending). Dropped the "organiser's/participant's week" and "Same Friday, same friends" side-captions.

### Architecture rebuild - 6 pages -> 1 animated slide (commit 0da58d0)
- Added `data-focus-steps="client api db shared ship"` to the `#arch-base` section. The engine treats this slide specially: step 0 = clean overview (no focus); steps 1-5 set `data-focus` to each layer, and CSS spotlights that layer (`.spot--X` lifts above `.scrim`) and shows its caption (`.arch-cap[data-for="X"]`).
- De-crowded the base diagram: dropped the 6 monospace endpoint chips from the frontend rows (the endpoints live in the frontend caption now), bumped diagram fonts to projector-legible sizes (`.sr-name` 17->20, `.tier-names` ->17, `.tier-pkg` ->15, `.router-chip` ->16, connector labels ->14/15), shortened the shared-core band, tagged Clerk third-party.
- Replaced the single JS-swapped `.arch-cap` with 5 static caption blocks shown by CSS per `data-focus`; **deleted the clone-generator `<script>` entirely.** The deck dropped from 43 to 38 pages and the architecture prints as one clean overview page.

### Verification (commit 7f26405)
- Full **live-view sweep**: headless screenshot of all 38 slides at `#N.9` (clamped to fully-built) -> 6x7 contact sheet -> confirmed every slide renders built.
- **PDF**: `./export-pdf.sh` -> 38 pages, 1440x810pt -> rendered all 38 pages into a contact sheet -> confirmed fully-built fidelity (curves drawn, bars full, arch as clean overview).
- **Mid-build spot-checks** across diverse slide types (#2.2 persona, #13.4 archetypes, #20.3 walkthrough, #35.3 eval rows) confirmed step-by-step reveal works deck-wide.
- 0 em-dashes; 121 `.frag` elements; rewrote `v2/README.md` for the new build model + corrected slide numbers.
- Updated Linear DRP-72 (comment + Done); saved a project memory (`presentation-v2-animation-engine.md`).

### Bug fixed mid-verification (in commit c051d16)
The closing slide rendered **blank** in the live view (counter said 38/38 and the DOM showed it `is-active`, but the canvas was dark). Root cause: the closing carried an inline `position:relative` that **overrode the deck's base `position:absolute`**; as the last in-flow `position:relative` section it stacked *below* the fixed-height (1080px) canvas, off the visible area. It has no absolutely-positioned children, so removing `position:relative` (letting it inherit `position:absolute`, overlaid at top:0) fixed it. Diagnosed by `--dump-dom` (confirmed 38 sections, closing was `is-active`).

### Follow-up: white crossfade (commit 4d661ce)
User feedback: "between the slides can you make it fade to white instead of fade to black. its too flashy." The slide canvas had no background, so during the .3s opacity fade the dark viewer surround (`#deck-root` radial gradient) showed through -> read as a "fade to black" flash. Fix: gave `#deck-canvas` a white (`var(--surface)`) background (opaque, so it fully occludes the dark surround within the slide area), and turned the hard cut into a real crossfade (the leaving slide keeps `visibility` for the .3s via `transition: ... visibility 0s linear .3s`, so both slides dissolve). Static slides are unaffected (all slide backgrounds are opaque); the PDF is unchanged.

## Key decisions & rationale
- **Single self-contained `index.html` + `styles.css`, no build step** - matches the existing deck architecture (CLAUDE.md mandates it) and keeps the PDF export faithful.
- **`.frag` reveal via individual `translate`/`scale`, not `transform`** - the deck is full of tilted stickers (`transform: rotate(...)`); using `transform` for the reveal would clobber their rotation. Individual properties compose with `transform`.
- **`@media print` forces frags visible** - the print CSS already forces every `<section>` visible/opaque/paged; without a matching `.frag` override the PDF would export slides with missing content. This was the single most important correctness constraint (verified before building 38 slides on it).
- **Keep `advance()`/`go()` as the entry points, make them step-aware** - the keydown/click/control-bar handlers all call them, so the engine slotted in with minimal runtime surgery.
- **Architecture as one `data-focus-steps` slide, not the cloned tour** - the user picked "one clean PDF page"; the spotlight-walk was already the right idea, just buried under clutter and split across 6 near-identical pages. Driving `data-focus` from the step engine unified the mechanism and removed ~70 lines of generator JS.
- **I owned all editing myself (no parallel editing agents)** - the deck is ONE file; parallel agents editing it would conflict (per the repo's "apply sequentially on contended files" pattern). Agents were used only for read/inventory. This made the session long but conflict-free.
- **Targeted-anchor edits over whole-section replacement** - to avoid reproducing the long `data-speaker-notes` strings, most edits anchored on a unique inner string (card title, eyebrow colour, persona name) and inserted `class="frag"`. Whole-inner-body replacement (from the unique `<h1>` title through `</section>`) was used for the curves and complex slides.
- **Commit per block** - per CLAUDE.md's "commit in modular chunks" rule, each verified block was its own commit so history stays bisectable.
- **Crossfade through white** - the user wanted "not flashy"; white is inherently softer than black and most slides are light, so a white dissolve is nearly invisible between light slides. An opaque white canvas makes a black flash impossible (the dark root is fully occluded).

## Things learned / discovered
- **Subagents HTML-escape verbatim code in their results** (`&gt;`, `&amp;`). Never paste a subagent's "verbatim" code as an exact-match `old_string` - read the real file bytes.
- **Read-tool line numbers drift** as you edit a file; never trust cached line numbers across edits. Anchor edits on unique strings; use `grep -n` to re-locate when needed.
- **Trailing-space edit trap (made twice):** matching `...>One plan, ` (with trailing space) and replacing with `...>One plan,` silently deletes the space before the next `<span>`, producing "One plan,decided live". Preserve trailing spaces in both `old`/`new`, or re-add with a follow-up edit.
- **The `position:relative` off-screen gotcha** (cost ~an hour): every `#deck-canvas > section` is `position:absolute` (overlaid). A section given inline `position:relative` becomes in-flow; if it is not the first in-flow section it stacks below the fixed-height canvas and renders blank live. The arch needs `position:relative` (via the `.arch` class, for scrim/caption) and the cover gets away with it (first in-flow). Verify any such slide with a `#N` screenshot.
- **Headless screenshot harness:** `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1920,1080 --virtual-time-budget=3000 --screenshot=out.png "file://.../v2/index.html#30.3"`. The `#N.S` deep-link boots straight into slide N at build step S, so any animation state is screenshot-able. `--dump-dom` (with `--virtual-time-budget`) dumps the post-JS DOM (incl. runtime-applied classes like `is-active`) - useful for diagnosing render bugs.
- **ImageMagick `montage` prints a harmless `unable to read font` warning and exits 1 but still writes the output file** - check for the file, not the exit code.
- **The export script** (`export-pdf.sh`) uses Chrome `--headless=new --print-to-pdf --virtual-time-budget=20000 --run-all-compositor-stages-before-draw`; the 20s budget lets any boot-time JS settle before the snapshot.
- **The deck is excluded from `pnpm check`/biome** (CLAUDE.md + commit 66de11e). Correctness = it renders right and the PDF exports faithfully, not lint.

## Current state
- `presentation/v2/` is a complete, decluttered, fully animated 38-slide deck with a faithful 38-page `bethere-deck.pdf`. All 38 slides verified rendering in built state (live sweep + PDF contact sheet); mid-build reveal verified across slide types.
- 9 DRP-72 commits on `dev`: 7f0fed0 (engine+cover), 58ab037 (1-9), a595c8a (10-14), 641cfc4 (15-21), 996de5c (22-29), 0da58d0 (arch), c051d16 (31-38 + closing fix), 7f26405 (PDF+README), 4d661ce (white crossfade). Working tree clean.
- Two non-DRP-72 commits appeared between my PDF commit and the crossfade commit (ff10e9c `docs(summary): reseed-live-demo-data-persona-binding`, eb480a2 `chore: commit random`) - made outside this deck work; not part of v2.
- **`presentation/CLAUDE.md` still names `v1/` as the current deck**; I deliberately did not flip "current" to v2 (that's a team/submission decision). v2 is ready for promotion when the team chooses.
- Linear DRP-72 = Done with a full summary comment.
- An untracked file `presentation/human/DRP - Final Presentation (3).pdf` was present (a human reference drop, not mine) - left untouched.

## Conventions, commands & workflows
- **Edit `v2/index.html` + `v2/styles.css`; re-export with `cd presentation/v2 && ./export-pdf.sh`** after any change.
- **Animate a new element:** add `class="frag"` (reveals in DOM order). Group simultaneous reveals by wrapping them in one `.frag`. For SVG/opacity-only use `.frag--still`; for a growing bar use `.frag--bar` with `style="--w:NN%"`. The slide's title/hero stays static (visible on entry); everything else is a fragment.
- **The architecture slide** is driven by `data-focus-steps`, not `.frag`; its 5 captions are `.arch-cap[data-for="..."]` shown by CSS on the active `data-focus`.
- **Verify a build step** headlessly with the `#N.S` deep-link + the Chrome screenshot command above; eyeball a montage with `pdftoppm` + `montage`.
- **Brand rules:** no em-dashes (use hyphens), no eyebrow/kicker lines, no monospace as decoration (only code identifiers), tokens not raw hex, one dominant accent per slide.
- **Commit in modular chunks** on `dev` (deck work goes straight to `dev`, no feature branch); reference `(DRP-72)`; Co-Authored-By trailer required.
- **Track in Linear** (team DRP_02) religiously.

## Known issues / caveats / risks
- **Speaker notes are per-slide, not per-step.** Collapsing the arch into one slide means its notes drawer shows one overview narration for all 5 spotlight steps (the on-slide captions carry the per-layer detail). The engine has no per-step notes mechanism.
- **The `position:relative` gotcha is latent** for any future section that needs absolute children - give the child a relative wrapper, or verify the slide renders live.
- **Slide-transition crossfade can't be screenshot headlessly** (it's time-based); the white-fade fix is deterministic CSS (opaque white canvas behind a fading slide) but was verified by reasoning + static render, not a captured mid-transition frame. Eyeball it live.
- **Minor brand-purity items left untouched** (out of scope for declutter+animate): a few multi-colour mock avatar hex values (e.g. slide 21 `#3F7BA8`), a couple of structural HTML comments in the arch markup, and the audit's note that the slide-24 `revealGoing()` code chip should be `settlePhase()` (a content-accuracy fix, not chrome).
- **Stat citations unverified** (US Surgeon General 2023 / BBC / ONS on slide 10) - the README flags these to confirm before presenting.

## Next steps
- Team to decide whether to promote `v2/` to the current deck (update `presentation/CLAUDE.md` and the submission PDF path if so).
- Eyeball the live deck end-to-end (especially the white crossfade and the curve/arch animations) on the presentation machine; rehearse the right-arrow build pacing.
- Optional: per-step speaker notes for the arch slide; tokenise the remaining mock avatar hex; fix the `revealGoing()`/`settlePhase()` code-chip label; verify the slide-10 third-party stats.

## References
- Deck: `presentation/v2/index.html`, `presentation/v2/styles.css`, `presentation/v2/bethere-deck.pdf`, `presentation/v2/README.md`.
- Edit guidance: `presentation/CLAUDE.md`; brand bible: `presentation/context/design-language-prompt.txt`; mark scheme + audit: `presentation/_drafts/final-presentation-audit-2026-06-15.md` and `presentation/context/helpful-documents/assessment-template-2026.md`.
- Prior deck: `presentation/v1/` (the starting point; unchanged).
- Memory: `~/.claude/projects/-Users-gong-Programming-drp-02/memory/presentation-v2-animation-engine.md` (engine mechanics + the position:relative gotcha).
- Linear: DRP-72 "Presentation v2: declutter deck + universal right-arrow build animation" (https://linear.app/drp-02/issue/DRP-72).
