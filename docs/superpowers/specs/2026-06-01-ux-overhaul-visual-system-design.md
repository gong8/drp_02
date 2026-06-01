# UX Overhaul - Refined Neobrutalist Visual System

- Date: 2026-06-01
- Status: Design approved, not yet implemented
- Linear: [DRP-25](https://linear.app/drp-02/issue/DRP-25/ux-overhaul-refined-neobrutalist-visual-system-peach-to-lavender)
- Mockup (open in a browser): `docs/mockups/m3-ux-overhaul/all-screens.html`

## 1. Summary

BeThere moves from the current flat "Sage" identity to a **refined neobrutalist** system: white, boxy cards with thin (2px) black outlines and hard offset shadows, floating on a gentle peach-to-lavender gradient, with heavy Archivo display headings, monospace date chips, tilted pink "sticker" tags, and a restrained two-accent palette. The look was chosen through a brainstorming session that explored editorial, minimalist, BeReal, claymorphic, skeuomorphic, glassmorphic, and several neobrutalist directions, then converged on a rounded-sticker neobrutalist take with a soft gradient (inspired by a user-provided neobrutalist dashboard reference).

This is a **restyle, not a rebuild.** No product behaviour, server contracts, tRPC data flow, navigation graph, or privacy model changes. We restyle markup and centralise new tokens in `apps/mobile/src/theme.ts`.

## 2. Design language

- Flat, boxy, structural. Thin black outlines plus hard offset (un-blurred) drop shadows give the "neo" edge.
- One soft full-screen gradient behind everything; cards are solid white so content stays legible.
- Few colours. Mono-dominant (black ink on white) with a two-accent semantic system.
- Heavy display type for hierarchy; monospace for dates and short technical tags; one tilted "sticker" tag for urgency.
- Rounded corners (18px on cards) keep it friendly rather than harsh.

## 3. Design tokens

Centralise these in `theme.ts` (extend, do not scatter literals).

### Colour
- Background gradient: `linear-gradient(160deg, #FCEFE8, #ECEAFF)` (peach to lavender). In RN use `expo-linear-gradient` with colors `["#FCEFE8", "#ECEAFF"]`, start `{x:0,y:0}`, end `{x:1,y:1}`.
- Surface / card: `#FFFFFF`
- Ink (text and borders): `#111111`
- Muted text: `#7D7A86`
- Brand / urgent accent (pink): `#FF5CA8` (stickers, primary "Create"/"Confirm", add button, selection checks in the conditional sheet)
- Going / affirmative (green): `#34A853` ("going" checks, "I'm in" button)
- Soft-pink shadow variant (optional): `#FF8FC2`
- Hairline divider: `rgba(0,0,0,0.10)`
- Scrim (sheet backdrop): `rgba(24,18,34,0.45)`
- Avatar palette (reuse existing `colorFor`): `#5F9472 #C9823F #7E6BB0 #3F7BA8 #B0654F`

### Status semantics (restrained, learnable)
- Going: green check, green "I'm in".
- Awaiting / respond-by: pink sticker plus empty check box.
- Declined: muted row (grey text, optional strikethrough). No loud colour, to keep "few colours".

### Type
- Display / headings: **Archivo** 700/800/900. Screen title approx 26 to 27px, weight 900, letter-spacing -1px. Card titles 800 approx 18px. Button labels 800.
- UI / body: **Inter** 400 to 800. Labels, meta, body, overlines.
- Mono: **Space Mono** 700. Date chips, short status tags, uppercase technical labels.

### Radius
- Cards and sheets: 18px (sheet top corners 24px)
- Buttons: 14px
- Inputs: 12px
- Tabs and back button: 8 to 9px
- Date chips, sticker tags: 6px
- Add button: 7px
- Selectable chips (group picker): 999px (pill)

### Borders and shadow
- Borders: 2px solid ink on cards, buttons, inputs, chips; 1.5px on small checks; 1px on date chips.
- Shadow: hard, no blur. `4px 4px 0 #111` (cards, primary buttons), `3px 3px 0 #111` (inputs, back button, group cards), `2px 2px 0 #111` (chips, stickers, add button). Optional coloured-shadow variant uses the soft pink.

### Spacing
- Keep the existing `space` scale (4/8/12/16/24/32). Screen horizontal padding approx 14 to 16px.

## 4. Components

- **ScreenBackground**: full-bleed gradient wrapper that hosts every screen.
- **Card**: white, 2px ink border, 18px radius, hard shadow. The base for most surfaces.
- **FeaturedCard**: event hero. Date chip plus tilted pink sticker on the top row, Archivo title, muted meta line, footer with going-avatar stack and "+N going".
- **ListContainer + Row**: one bordered card containing rows split by top hairlines. First row is an "add" row (dashed bottom separator) with a pink add button.
- **StatusCheck**: square check. Empty = awaiting; green filled = going; pink filled = selected (conditional sheet).
- **DateChip**: monospace, 1px ink border, small.
- **StickerTag**: tilted 4deg, pink fill, white text, hard shadow, monospace. Used for countdown / urgency.
- **Tabs**: segmented filter (All / Going / Awaiting / Declined). Active tab = black fill, white text.
- **Buttons**: Primary (pink fill), Affirmative (green fill, for "I'm in"), Outline (white). All boxy with 2px border and hard shadow.
- **Chips**: selectable pills for the group picker. Selected = black fill.
- **Field**: boxy input with an uppercase mono-ish label above.
- **Avatar**: bordered circle, colour from the palette, initials.
- **BottomSheet**: white, 2px top border, handle, segmented toggle, member picker, Confirm.
- **BackBar**: boxy back button plus Archivo screen title.
- **HeaderBlock**: small overline, Archivo h1, avatar top-right.

## 5. Per-screen scope

All seven existing screens, restyled to the above. Behaviour and data unchanged.

1. **Home (Dashboard / Meetups)**: header block, a FeaturedCard for the next "needs you" meet, status Tabs, then the ListContainer (add-row plus event rows with status checks and date chips). Note: this is a redesign of today's Awaiting/Going/Declined sectioned list into featured-plus-tabbed-checklist. Tabs map to the same statuses.
2. **Event detail**: BackBar, event Card (date chip, countdown sticker, title, location, time, going avatars), then three stacked response buttons: "I'm in" (green), "I'll go if..." (outline, opens sheet), "Can't make it" (outline muted). After responding, show status plus a "Who's going" list (avatar, name, check). Privacy: only the going crowd is listed, never a public "no".
3. **"I'll go if..." sheet**: BottomSheet with the at-least-one / all-of-them segmented toggle, member picker (pink selection checks), Confirm (pink).
4. **Suggest a meet (Create event)**: BackBar, group Chips, boxy Fields for title / location / date / time, pink Create.
5. **Your groups (Groups list)**: header block, group rows as boxy Cards (avatar, name, member count, caret), pink New group.
6. **Group detail**: BackBar, editable name Field, member ListContainer with remove, outline "Add to group" (its add sheet reuses BottomSheet styling).
7. **New group (Create group)**: BackBar, one Field, pink Create group. Demonstrates the calm empty/airy state.

## 6. Implementation notes (React Native / Expo)

- **Fonts**: add Archivo, Inter, Space Mono via `@expo-google-fonts/*` (or `expo-font`) and load them at app start; expose `font` tokens in `theme.ts`. The current theme defers fonts to system; this overhaul activates them.
- **Gradient**: use `expo-linear-gradient` as a screen-level background component. No blur is used anywhere, so there is no `backdrop-filter` / GPU concern.
- **Hard offset shadows**: RN shadows are blurred (`shadowRadius`) and Android `elevation` cannot produce a crisp offset. To get the `4px 4px 0` look cross-platform, render a reusable wrapper that places a solid ink "shadow" View absolutely behind the card, offset by (4,4), same radius. Document this as `<HardShadow>` so every boxy surface is consistent.
- **Tilted sticker**: `transform: [{ rotate: "4deg" }]` on the tag View.
- **Tokens, not literals**: every colour, radius, border width, and shadow offset becomes a named token in `theme.ts`. No scattered hex/px.
- **Quality gates**: keep `pnpm lint`, `pnpm typecheck`, `pnpm test` green (CI/CD depends on it). No em dashes anywhere (repo convention).
- Mockups are HTML approximations; the RN build should match intent (hierarchy, spacing, weight, colour), not pixels.

## 7. Open questions / decisions

- **Navigation**: the app uses bottom tabs (Meetups / Groups) today. The new home has no bottom bar drawn. Decide: keep styled bottom tabs, or move to a top switch. Recommendation: keep bottom tabs, restyled, for familiarity.
- **Two accents**: pink (brand/urgent) plus green (going). Confirmed acceptable. Option to make "I'm in" pink too if we want a single accent.
- **Home redesign**: featured-plus-tabs-plus-checklist replaces the status-sectioned dashboard. Confirmed as intended.
- **Dark mode**: out of scope for this pass.

## 8. References

- Permanent mockup of all screens: `docs/mockups/m3-ux-overhaul/all-screens.html`.
- Chosen direction label: "Rounded + Sticker, Peach to Lavender".
- Inspiration: user-provided neobrutalist dashboard / help-center reference (gradient background, boxy outlined cards, heavy headings, mono chips).
- Supersedes the visual identity in `theme.ts` and the aesthetic guardrails noted in `docs/mockups/m2/README.md` for future work.

## 9. Execution addendum (2026-06-01)

A Clerk auth + web feature landed on `dev` after this spec was approved, so the build adapted:
- **Navigation:** bottom tabs, now THREE - Meetups / Groups / **Account**. Sign-out lives in the Account tab, replacing the old header `AccountButton` (removed).
- **Auth screens in scope:** `SignIn` and a new `Account` screen were restyled into this system; the Clerk SSO + dev-bypass logic is unchanged.
- **Home filter:** All / Going / Awaiting / Declined (all four shipped).
- **Header avatar:** Home and Groups show the real signed-in user's initial via an `AccountAvatar` component (decorative; identity and sign-out are the Account tab).
- **Data:** `events.mine.goingPreview` items carry `{ color, initial, uid }`; `uid` is the stable list key.
