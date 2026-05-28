# M2 mockups - restyle the Expo app to match

**Milestone:** M2 Concept Development (review 29 May 2026 - "end of week 2").
**Goal of this folder:** hold the UI mockup images for BeThere, then drive Claude to **restyle and extend the existing Expo screens to match them** - without breaking the working tRPC data flow, navigation, or the privacy invariants.

### What M2 grades (and how this folder feeds it)

The restyled app *is* the mock-up real people test, so this work targets several M2 rows directly:

- **Visual representation of digital touchpoint** - top: *"Meaningful mock-ups with clear interlinked core interaction."* → a designed-looking app that stays clickable end-to-end through the loop.
- **Preparing a walking skeleton** - top: *"Current state prototypes a core context-relevant interaction"* (not a generic hello-world/todo/map/login). → the availability → match → moment → reveal loop stays the centrepiece.
- **How real people interacted / Quality of feedback** - top marks need *rich interactive feedback* + *deep concept validation* from real users. → the polished app is what you put in front of testers; do that testing separately and capture excerpts.
- **Development process** - Git → CI → public deployment → *functioning CD*. → the restyle must keep `pnpm typecheck`/`pnpm test` green so CI/CD stays functioning.

---

## 1. Where to drop the images

Put every mockup screen in **`screens/`** (next to this file). PNG or JPG. Drop as many as you have - one per screen, or several variants per screen.

## 2. Naming convention

Files are grouped by screen, with a letter suffix for variants:

```
screens/
  home-a-plans.png              dated agenda of meets + status + "Suggest a Meet"
  home-b-confirm-countdown.png  agenda with a "confirm within 8h 49m" item
  home-c-confirmed.png          agenda after confirming (GOING)
  groups-a-list.png             "Your Groups" - collapsed rows + avatars
  groups-b-expanded.png         one group expanded → members + Confirm
  suggest-create.png            create form: title / desc / date / time / map
  moment.png                    "I will make it / won't / if…"
  moment-if-sheet.png           conditional: member select + all/at-least-one
  reveal-whos-going.png         "Who's Going" checklist
  notification-results.png      lock-screen push: "Results are in!"
```

**Names are a convenience, not a requirement** - Claude maps each image to a screen by its content.

## 3. Mockup → target file

The loop and each screen's intent are specified in `docs/superpowers/specs/2026-05-28-bethere-product-design.md` §5–6. Current implementation:

| Mockup(s) | Concept | Target file |
|---|---|---|
| `groups-a-list`, `groups-b-expanded` | "Your Groups" - group rows w/ avatars; expand → members + Confirm | `apps/mobile/src/screens/Home.tsx` (expanded state not built) |
| `home-a/b/c` | Dated agenda of your meets w/ GOING / NOT GOING / confirm-within status | no screen yet - needs a "my plans" API (see §6) |
| `suggest-create` | Create a meet: title, description, date, time, location map | `apps/mobile/src/screens/Suggest.tsx` (currently chip-based) |
| - | Private "when are you free" (no mockup) | `apps/mobile/src/screens/Availability.tsx` |
| - | The calm wait (no mockup) | `apps/mobile/src/screens/Floating.tsx` |
| `moment` | Blind, timed proposal - make it / won't / if… | `apps/mobile/src/screens/TheMoment.tsx` |
| `moment-if-sheet` | Conditional: member select + all / at-least-one + Confirm | `apps/mobile/src/screens/TheMoment.tsx` (Modal) |
| `reveal-whos-going` | "Who's Going" list of the confirmed crowd | `apps/mobile/src/screens/Reveal.tsx` |
| `notification-results` | Push: "Results are in!" | no in-app screen - future `expo-notifications` |

Navigation lives in `apps/mobile/App.tsx`; design tokens in `apps/mobile/src/theme.ts`.

## 4. When the images are in, run the prompt

Open a fresh Claude Code session at the repo root and either paste the contents of **`PROMPT.md`** or say: *"Follow `docs/mockups/m2/PROMPT.md`."*

## 5. Aesthetic guardrails (so a mockup can't drag the app off-brand)

The agreed identity (product-design spec §11) is **flat: one accent, hairline borders, generous whitespace, minimal copy - no gradients, decorative badges, or glow shadows.** If a mockup introduces any of those, the prompt tells Claude to flag it and match the *intent* (layout, hierarchy, spacing) rather than copy an off-brand effect. Tell Claude if you'd rather it follow the image literally.

## 6. Alignment status - first pass (2026-05-28)

A quick "match a little closer" pass, keeping the working tRPC data flow and navigation intact.

**Aligned:**
- **Home** - title → "Your Groups"; each group row now has a coloured circular avatar; primary button → "Suggest a Meet"; meta → "Members (N)".
- **The moment** - responses relabelled to **"I will make it" / "I will make it if…" / "I won't make it"**, all three as full-width boxes; the conditional sheet titled "I will make it if…", toggle "At least one of / All of them", action → **Confirm**.
- **Reveal** - now a **"Who's going"** list (avatar + name + ✓) instead of the avatar cluster.
- **Suggest** - title → "Suggest a meet", action → "Create".

**Deferred / flagged (need a decision or backend work):**
- **Dated agenda home** (`home-a/b/c`) - the GOING / NOT GOING / "confirm within" plans list needs a "my upcoming plans" API that doesn't exist yet. Current Home is the groups list instead.
- **Group expand** (`groups-b-expanded`) - needs member names + a per-group confirm flow; `groups.mine` only returns a member *count* today.
- **Suggest as a full create form** (`suggest-create`) - title/description/photo/location-map aren't accepted by `suggestions.create` (the spec deliberately uses activity + loose-window chips). Kept the chip flow; full form would need shared-schema + API changes.
- **Reveal "not going" rows** - `reveal-whos-going` shows red ✗ for people who declined. That **violates the privacy invariant** (no public "no", spec §8.4) and the API only returns the confirmed crowd, so only the "going" rows are shown. Say so if you want the ✗ rows anyway.
- **`notification-results`** - a push-notification mock; no in-app screen (future `expo-notifications`).
- Mockup response colours (green/red/orange) were kept to the single-accent brand; the labels and layout match, the loud colours don't.
