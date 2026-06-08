# BeThere - Design Language (visual brand kit)

> Paste this whole file into an image/layout-generation AI as the style brief when producing
> BeThere's M4 visual artifacts: the **Project Pitch Leaflet**, the **impact poster / cover-story
> mock-up**, or any on-brand graphic. It is the single source of truth for how BeThere looks and
> sounds. Everything here is extracted from the live app (`apps/mobile/src/theme.ts`, `ui/`,
> `lib/copy.ts`) so generated artifacts match the real product, not a generic AI aesthetic.

---

## 1. The product (one paragraph, so you don't drift)

**BeThere** is a group meetup-coordination app that turns a vague "we should hang out" into a firm
plan with **no organiser and no public "maybe."** A creator sends **one plan** to a group. The group
publicly **+1s ("votes" on)** candidate **times** (when) and **activities** (what/where) - momentum
counts are shown, but **no names ever are; it's the group's, not one person's**. When voting closes
the top time and activity win, and the plan runs a blind, timed **moment** where members RSVP
**Yes / Can't make it / "I'll go if [people]"**. It either **clears** (it's on) or quietly
**fizzles** with no trace. A per-user dashboard sorts plans into **Reacting / Awaiting / Going /
Declined**.

**The problem it solves:** group plans die in the gap between "we should hang out" and an actual
time/place - nobody wants to be the organiser, and public "maybes" let everyone hedge. BeThere
removes the organiser and the maybe.

**Tagline options (terse, lowercase-friendly):** "Plans, without the organiser." / "No organiser.
No maybe." / "Be there."

---

## 2. Aesthetic in one line

**Refined neobrutalism.** Soft lavender-to-blush gradient canvas; crisp white cards with **ink-black
2px borders and hard, zero-blur offset shadows**; heavy Archivo display type against clean Inter
body; three loud semantic accent colors used sparingly. Confident and playful, never corporate,
never soft/glassy. Flat color, hard edges, generous breathing room.

---

## 3. Color palette

Use these exact hex values.

| Token | Hex | Role |
|---|---|---|
| Background gradient (start) | `#FCEFE8` | warm blush - top/left of the canvas |
| Background gradient (end) | `#ECEAFF` | cool lavender - bottom/right of the canvas |
| Surface | `#FFFFFF` | cards, sheets, pills |
| Ink | `#111111` | all borders, shadows, primary text |
| Muted | `#7D7A86` | secondary/caption text |
| On-ink | `#FFFFFF` | text/icons on a filled ink or accent block |
| Selection tint | `#F1EEF6` | lavender wash for selected/your-own rows |
| **Brand pink** | `#FF5CA8` | **primary action, urgency, time-pressure, "vote/reply now"** |
| **Going green** | `#34A853` | confirmed / affirmative / "you're in" |
| **Open purple** | `#7E6BB0` | open / still being decided / collecting |

**Rules:**
- The **gradient is the page background** for nearly every surface. Diagonal, blush -> lavender.
- **Ink black is structural**, not decorative: every border and every drop-shadow is `#111111`.
- Accents are **semantic, not random** - pink = act now, green = settled-good, purple = in-progress.
  Don't recolor them for taste. One dominant accent per artifact (usually pink).
- Never use grey borders, soft pastels-as-fills, or gradients *inside* components. Gradient = canvas only.

---

## 4. Typography

| Use | Font | Weight |
|---|---|---|
| Screen titles / hero | **Archivo** | 900 Black (`Archivo_900Black`), letter-spacing tight (-1) |
| Titles, buttons, loud pills | **Archivo** | 800 ExtraBold (`Archivo_800ExtraBold`) |
| Row labels / emphasis | **Inter** | 700 Bold |
| Body / captions | **Inter** | 500 Medium |
| Numbers (counts, times, countdowns) | either | **tabular / mono figures** |

- **Hierarchy is created by weight + size, not color.** Big Archivo Black headline, then Inter body.
- Headlines can be **tight, punchy, lowercase or sentence case** - confident, not shouty-caps walls.
- Counts and times always use **tabular figures** so they don't jitter.
- Free substitutes if Archivo/Inter unavailable: Archivo Black -> any heavy grotesque (e.g. Anton,
  Druk-like); Inter -> any neutral humanist sans.

---

## 5. Component / shape language

Borders, radii and shadows are the brand. Reproduce them precisely.

- **Borders:** `2px` solid ink (`#111111`) on cards, buttons, inputs. `1px` ink on small pills.
- **Hard shadow:** a solid ink rectangle offset **`+4px` down/right with ZERO blur** behind cards
  and buttons (`+3px` for smaller chips/inputs). This is the signature - it is NOT a soft drop
  shadow. Think "sticker peeled off the page," flat offset block.
- **Radii:** cards `18`, buttons `14`, inputs `12`, small tags `6`, pills fully round (`999`).
- **Cards:** white surface, ink border, hard shadow. The default container for everything.
- **Buttons:** filled block + ink border + hard shadow. Primary = **pink** fill, Affirmative =
  **green** fill, Outline = white fill / ink text, Ghost = transparent / no shadow (quiet secondary).
  Button labels are Archivo (display), centered.
- **Pills / tags:** two kinds - *outline* (white, ink border, small bold label = a data chip like a
  date or count) and *solid* (filled accent color, white Archivo label, often **tilted ~4 degrees**
  with a hard shadow = a loud status sticker, e.g. "Going", "Voting closes").
- **Status stickers tilt.** A slight rotation + hard shadow makes a status read loud and playful.
- **Layout:** `16px` screen gutter, generous vertical rhythm, single-column mobile-first stacks.
  Lots of whitespace between grouped cards.

**Do NOT:** add glows, soft/blurred shadows, glass/frosted effects, rounded-everything blandness,
drop-shadow gradients, emoji-as-icons clutter, or stock-photo backgrounds. Keep it flat, bordered,
and confident.

---

## 6. Voice & copy (use these exact strings where relevant)

Terse, warm, plain-English. One word does the job. No em dashes (use hyphens). No corporate filler.

- Reacting to an option is **"Vote"** / **"Voted"**. A plan is a **"meetup"**.
- Decline = **"Can't make it"**. Confirmed = **"You're in"**. Pending = **"Awaiting you"**.
- Privacy line, said once: **"No names, just the group."** and **"Sent anonymously - the group sees
  the meetup, never that it came from you. No names, ever."**
- Deadlines: **"Voting closes"**, **"RSVP closes"**. Tags: **"Top pick wins"**, **"Blind"**.
- Failure state: **"Didn't come together"** (never "failed").
- Counts: **"3 options"**, **"3 going"**, **"2 actions required"**.
- Create-flow questions are casual: **"Who's it for?"**, **"What do you fancy?"**, **"When could it
  be?"**, **"Ready to send?"**.

---

## 7. Key user journey (for the leaflet's before/after panel)

**Before BeThere:** A group chat with "we should do something soon!!" -> 40 messages -> nobody
commits -> the plan dies. The organiser burns out; everyone hedges with "maybe."

**With BeThere:**
1. Someone sends **one meetup** to the group (a few candidate times / activities, or a fixed one).
2. The group **votes** on times and activities - momentum is visible, **but who voted is never shown**.
3. Voting closes; the **top time + activity win** automatically.
4. A blind, timed **moment** opens: each person RSVPs **Yes / Can't / "I'll go if [people]"**.
5. It **clears** ("you + 4 others are in") or quietly **fizzles** - no awkward dead plan in the chat.

**After:** A firm time and place, real commitment, zero organiser, zero public maybe.

---

## 8. Artifact-specific notes

- **Pitch leaflet (1x A4):** lavender-blush gradient field; big Archivo Black product name "BeThere"
  + tagline; one phone mock-up showing a card-based meetup screen with a pink "Vote" button and a
  tilted green "Going" sticker; a compact before/after strip (§7); the problem statement (§1); a
  clear value prop. Tech-fair flyer energy - bold, scannable, one accent (pink) dominant.
- **Impact poster / cover-story:** frame the wider positive consequence - groups that actually meet
  up, less flaking, no one stuck being the organiser, no social pressure of public "maybe." Same
  visual system, can go bolder/larger on the Archivo headline.
- **Logo direction:** wordmark in Archivo Black, ink on light or white-on-pink, optionally a single
  hard-shadow block or a checkmark/pin motif. Keep it flat and bordered; no gradient inside the mark.

---

## 9. Quick token reference (paste-ready)

```
Gradient:  #FCEFE8 -> #ECEAFF (diagonal, canvas only)
Surface:   #FFFFFF      Ink: #111111      Muted: #7D7A86
Pink (primary/urgent): #FF5CA8
Green (going):         #34A853
Purple (open):         #7E6BB0
Borders: 2px ink (1px on small pills)   Shadow: hard, 0-blur, +4px offset, ink
Radii: card 18, button 14, input 12, tag 6, pill 999
Type: Archivo 900/800 (display+buttons) · Inter 700/500 (labels+body) · tabular figures for numbers
Voice: terse, warm, plain. "Vote" · "meetup" · "Can't make it" · "No names, just the group."
```
