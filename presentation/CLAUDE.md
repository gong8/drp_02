# CLAUDE.md - BeThere final presentation

Guidance for editing the **BeThere final-presentation deck**. This folder is the
whole presentation workspace: the deck, the PDF export, and all supporting
context. Read this before changing slides.

## What this is

A self-presenting **HTML slide deck** (16:9, refined-neobrutalist BeThere
brand). The deck is the source of truth; the submission **PDF is generated from
it**. There is no build step and no framework - just HTML + CSS + a small
vanilla runtime. (Authored `<section>`s number ~38; the architecture
**spotlight tour** generates 5 more at load, so the PDF is 43 pages - see
"Architecture spotlight tour".)

**Decks are versioned in self-contained folders. The CURRENT (final) deck is
`v4/` - edit `v4/index.html` + `v4/styles.css` and export with
`v4/export-pdf.sh`.** `v4/` is a clone of `v3/` with a feedback pass: on-slide
step reveals are OFF everywhere except the two journey-map slides
(`.slide--animate`, screens 3 & 6), the presenter control bar is hidden, the
journey maps gained green/red positive/negative axis bands, slide 18 is a
left-to-right design timeline, and the demo-1 intro card + the whole onboarding
user story (incl. demo 2) were cut - leaving 36 slides. In `v4/`, `index.html`
is canonical: the `_build/` fragments were NOT re-synced, so do not rebuild from
them. `v3/` keeps `v2/`'s animated engine and visual language and
folds in the team's human deck (`reformat/`) for the persona/problem framing,
the four user stories, and the whole evaluation / impact / looking-ahead
section; it had 41 slides and uses the team's official survey figures (n=47).
`v0/`, `v1/`, `v2/` and `v3/` are frozen earlier snapshots; `reformat/` is the team's
human-made reference deck (re-styled in the brand). Each version folder is
independent (its own assets + export script), so paths below are relative to the
version folder you are editing.

```
presentation/
  v4/                 the CURRENT (final) deck (edit this; clone of v3 + feedback pass)
    index.html        the deck: one <section> per slide + the runtime (bottom <script>) - CANONICAL
    styles.css        :root brand tokens + component classes + viewer chrome
    bethere-deck.pdf  the exported submission PDF (regenerate after edits)
    export-pdf.sh     headless-Chrome PDF export (faithful: same engine, fonts embedded)
    README.md         how to present / export (keyboard nav, etc.)
    assets/           images referenced by slides (personas, screens, sketches, process)
    _build/           STALE in v4 (fragments not re-synced after the feedback pass)
    reference/        architecture-slides.html (richer arch reference), preview.png
  v0/ v1/ v2/ v3/     frozen earlier snapshots (v3 = the deck v4 was cloned from)
  reformat/           the team's human-made reference deck (re-styled in the brand)
  context/            design-language-prompt.txt, helpful-documents/, project-context/
  human/              the team's raw human-made reference decks (PDFs)
  CLAUDE.md           this file
```

The deck is graded against the **DRP marking rubric**:
`context/helpful-documents/assessment-template-2026.md` (Claude-readable conversion
of the official `Assesment_Template_2026.pdf`). The **Final Project Evaluation
(50%)** scoring sheet there is what the presentation + demo are marked on - check
slides cover its criteria (problem, target audience, stakeholder groups, technical
quality, architecture diagram, evaluation/future work).

## How to edit a slide

Each slide is one `<section>` in `index.html` with three data-attributes:

```html
<section data-label="Walkthrough: Vote" data-screen-label="15"
         data-speaker-notes="Full spoken script for this slide..."
         class="slide slide--paper" style="padding:78px 110px 72px;">
  ...
</section>
```

- `data-label` / `data-screen-label` - shown in the speaker-notes drawer + counter.
- `data-speaker-notes` - the spoken script (one long line). Keep it accurate.
- Slides are authored at **1920x1080 px**. The runtime scales the active slide
  to fit; you write real px.

## Style with tokens + classes - NOT inline hex

Colours live once in `:root` (top of `styles.css`). **Never paste a raw hex into
a slide** - use the token, so a palette change propagates everywhere.

```
--ink --surface --pink --green --purple --muted --grey
--blush --lav --paper   (canvas backgrounds)   --sand --tint-purple/-green/-blue
--sh-sm --sh --sh-lg     (hard neobrutalist shadows, offset down-right, zero blur)
```

Compose from the component classes (defined in `styles.css`); add per-instance
size/spacing inline:

| class | what |
| --- | --- |
| `.slide` + `.slide--blush` / `--paper` / `--ink` | the slide frame + its background |
| `.title` | hero heading (set `font-size` / `letter-spacing` inline) |
| `.hl` | the pink one-word highlight block (brand signature) |
| `.eyebrow` | uppercase Inter label (set `font-size` / `color` inline) |
| `.card` / `.card-ink` | white / dark neobrutalist card with hard shadow |
| `.chip` / `.pill` | Space-Mono data chip / rounded outline pill |
| `.sticker` | tilted status sticker (`transform:rotate(-4deg)`) |
| `.stat-num` | big tabular stat number |
| `.quote` | Archivo quote text |
| `.arrow-bar` / `.arrow-head` | thick ink connector (bar + triangle) |
| `.logo` + `.ico` + `.i-*` | tech-logo tile: a flat brand-colour glyph (`<svg class="ico i-trpc"><use href="#l-trpc"/></svg>`) in an ink-bordered white tile; colours are `--logo-*` tokens, never inline hex |

Tech logos are **simple-icons** (CC0) inlined once as `<symbol id="l-*">` in a
hidden sprite right after `<body>`, then referenced with `<use>`. To add one:
fetch `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/<slug>.svg`, paste
its `<path>` into a new `<symbol>`, add a `--logo-<name>` token + `.i-<name>`
rule in `styles.css`. Keep marks legible on white (deepen pale ones, e.g. React
cyan, or force ink, e.g. Drizzle).

The **architecture spotlight tour** (below) is the worked example of the full
kit - copy its patterns. The other slides use `.slide/.title/.hl/.eyebrow`;
their inner cards are still inline (tokenised) and can adopt `.card` etc.
incrementally - do it the way below so nothing shifts.

## Architecture spotlight tour - IMPORTANT

"Under the hood" is **not** a normal slide. It is ONE diagram shown as a sequence
of focus states; clicking advances the spotlight, and **each state is its own
`<section>` so it exports as its own PDF page**. The states walk the stack:
overview -> client -> api -> db -> shared -> ship.

- The diagram is authored **once** in the static `#arch-base` section (the
  overview). The 5 focus steps are **cloned from it at load** by a small
  generator `<script>` just above the runtime IIFE in `index.html`. So:
  - **Edit the diagram** (tiers, logos, layout) -> edit `#arch-base` only; every
    step inherits it, so the spotlight stays pixel-identical across pages.
  - **Edit a step's caption / speaker notes / which layer it lights** -> edit the
    `steps` array in that generator script (`focus`, `label`, `notes`, `cap`).
  - **Add/remove a step** -> add/remove an entry in `steps` (changes the page
    count; update the `01 / NN` counter seed + the slide count above).
- The spotlight is pure CSS: `.arch` is the stacking root (`isolation:isolate`),
  `.scrim` darkens everything, and `[data-focus="X"] .spot--X` lifts the focused
  group above the scrim. Do **not** give `.arch-diagram` a `z-index` (it would
  trap the focused group under the scrim).
- The generator runs synchronously before the runtime collects slides, and the
  PDF export gives JS a 20s virtual-time budget, so the cloned pages are present
  in both nav and the PDF. Always re-export and check the page count after edits.

## After ANY edit: re-export and keep it faithful

```bash
./export-pdf.sh           # regenerates bethere-deck.pdf (uses installed Chrome)
```

For a **structural refactor** (touching many slides), prove you didn't break
anything by diffing the new PDF against a baseline page-by-page:

```bash
cp bethere-deck.pdf /tmp/golden.pdf
( cd /tmp && pdftoppm -png -r 72 golden.pdf g/pg >/dev/null )   # baseline
# ...make changes, re-export...
# render new pages and compare each with Pillow ImageChops; pages you did not
# intend to change must be ~0% different. (This is how the token/class refactor
# was verified: 29 pages identical, only the redesigned slide differed.)
```

## Conventions

- **No em dashes anywhere** (repo-wide rule) - use hyphens. The brand voice guide
  (`context/design-language-prompt.txt`) says the same.
- Brand = **refined neobrutalism**: flat colour, ink borders, hard zero-blur
  offset shadows, heavy Archivo display type. No soft/blurred shadows, no
  gradients inside components, no AI faces. Read the design-language prompt.
- Fonts are **Archivo / Inter / Space Mono** (all Google Fonts - loaded via the
  `<link>` in `index.html`, so they embed into the PDF). Do not add other fonts.
- Keep the persona photo on the "Meet Millie" slide an `<image-slot>` (drop a
  real licensed photo, never an AI face).
- This deck is **not** part of the pnpm build - `pnpm check` does not touch it.
  Correctness = it renders right and the PDF exports faithfully.

## Verify facts against the codebase

Architecture/stack claims must match the real repo (the arch slide was verified
2026-06-15: Fastify 5, tRPC v11, React Navigation v7, 4 routers, 10 Postgres
tables). If you change the app, update `#arch-base` + the spotlight tour's step
captions and notes (the `steps` array). Research
numbers (n=43 survey, the interview quotes) and the third-party stats on slide 3
live in `context/project-context/` - cite, do not invent.
