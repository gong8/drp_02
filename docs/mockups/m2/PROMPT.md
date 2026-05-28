# Prompt — restyle the Expo app to match the M2 mockups

> Paste this into a fresh Claude Code session at the repo root (`drp_02/`), after dropping your mockup images into `docs/mockups/m2/screens/`. Or just say: *"Follow `docs/mockups/m2/PROMPT.md`."*

---

## Your task

I've added UI mockup images to `docs/mockups/m2/screens/`. **Treat them as the visual source of truth and restyle/extend the existing Expo (React Native) screens to match them** — layout, spacing, typographic hierarchy, colour, component shapes, and copy. This is for **Milestone 2** (review 29 May 2026): we want the walking skeleton to *look like* the designed product, not a skeleton.

This is a **front-end restyle, not a rebuild.** The app already navigates the full loop with live tRPC data. Keep all of that working. Do not change the product, the server contracts, or the privacy model.

## How this serves Milestone 2 (what's graded)

The M2 rubric ("Concept Development", reviewed 29 May 2026) grades these rows — keep them in mind as you work:

- **Visual representation of digital touchpoint (mock-ups for real people)** — top mark: *"Meaningful mock-ups with clear interlinked core interaction."* The restyled app **is** the mock-up. It must stay **clickable end-to-end through the core loop** (the "interlink") and read like a designed product, not a skeleton. A polished screen that dead-ends loses this row.
- **Preparing a walking skeleton** — top mark: *"Current state prototypes a core context-relevant interaction of your digital touchpoint"* — explicitly **not** a generic hello-world/todo/map/login app. BeThere's core context-relevant interaction is the **private availability → silent match → blind timed moment → reveal** loop. Keep that loop the centrepiece; never let the restyle flatten it into a generic-looking UI.
- **How real people interacted with the mock-up** + **Quality of feedback / validation** — top marks reward *rich, multidimensional interactive feedback* and *deep concept validation with real users*. That testing happens separately; **your job here is to make the app polished and demoable enough to put in front of real people and click through live** on a device.
- **Preparing development process** — Git → CI → public deployment → *functioning CD*. Out of scope for a restyle, but **don't break it**: keep `pnpm typecheck` and `pnpm test` green so CI/CD stays functioning.

## Read first (in this order)

1. `docs/mockups/m2/README.md` — the image→screen mapping and naming convention.
2. The images in `docs/mockups/m2/screens/`.
3. `docs/superpowers/specs/2026-05-28-bethere-product-design.md` — what BeThere is, the loop (§5), every screen's intent + the research finding it answers (§6), the inviolable principles (§4), and the visual identity (§11).
4. `apps/mobile/src/theme.ts` — the live design tokens (Sage palette, `space`, `radius`).
5. `apps/mobile/App.tsx` — hand-rolled navigation (`Route`/`Navigate`), the global Back header.
6. `CLAUDE.md` — repo conventions (pnpm-only, type chain, Linear tracking, branching).

## What BeThere is (one paragraph, so you don't drift)

A group meetup app that turns a vague "we should hang out" into a firm plan with **no organiser and no public "maybe."** People privately share *when they're free* (a fact, never a want); when enough overlap, the app fires one concrete proposal on a short countdown — **the moment** — answered blind as **Yes / "I'm in if…" / Can't**. If quorum clears it's **on** ("you + N others are in"); if not it **fizzles silently** with no trace. The product-design spec is authoritative; read it before touching a screen.

## Image → screen map

Match each image to its target file (full table in `README.md`):

| Mockup | Target file |
|--------|-------------|
| Home / Groups | `apps/mobile/src/screens/Home.tsx` |
| Suggest | `apps/mobile/src/screens/Suggest.tsx` |
| Availability | `apps/mobile/src/screens/Availability.tsx` |
| Floating | `apps/mobile/src/screens/Floating.tsx` |
| The moment | `apps/mobile/src/screens/TheMoment.tsx` |
| "I'm in if…" sheet | `apps/mobile/src/screens/TheMoment.tsx` (the `Modal`) |
| Reveal ("It clicked") | `apps/mobile/src/screens/Reveal.tsx` |

If a filename doesn't match, map by the image's **content** to the right screen. If there's a mockup for a screen that doesn't exist yet (e.g. a standalone **Firm plan** card, or a distinct **Silent expiry** state), tell me before adding a new route — don't silently invent navigation.

## Hard constraints — do not break these

1. **Keep the data flow.** Every screen's tRPC queries/mutations, loading/error/empty states, and the navigation in `App.tsx` must keep working. Restyle the markup; don't tear out the wiring.
2. **No server changes by default.** Don't touch `apps/api`, `packages/shared`, or the tRPC contracts. If a mockup clearly needs a field the API doesn't return, **stop and ask** — don't fake it or hardcode it.
3. **Privacy invariants stay intact** (spec §8). Availability and the moment must never render names, counts, or tallies of who else is in. The reveal is the *only* place the "in" crowd appears. If a mockup shows a count on Availability/Floating/Moment, flag it — it likely contradicts the thesis.
4. **Tokens, not magic numbers.** Use and *extend* `apps/mobile/src/theme.ts` (colours, `space`, `radius`). If the mockups introduce new colours/sizes/type styles, add them as named tokens there rather than scattering hex/px across files.
5. **Fonts:** `theme.ts` notes Lora/Inter are deferred (system font for now). If the mockups rely on them, load them properly (`expo-font` / `@expo-google-fonts/lora` + `inter`) and wire a font token — don't hand-pick system fallbacks per screen. Use `pnpm` to add deps.
6. **Aesthetic guardrails (spec §11):** flat — one accent, hairline borders, generous whitespace, minimal copy; **no gratuitous gradients, decorative badges, or glow shadows.** If a mockup contains an off-brand effect, match the *intent* (hierarchy, spacing, layout) and flag the deviation rather than copying it. (If I tell you to follow an image literally, do that instead.)
7. **pnpm only.** Never `npm`/`yarn`. Mobile imports `@bethere/api` **type-only**.
8. **Scope:** this is a restyle. No new product features, no refactors beyond what the visual match needs.

## How to work

- Go **screen by screen** in loop order (Home → Suggest → Availability → Floating → The moment + sheet → Reveal). Finish and self-check one before the next.
- For each screen: open the image and the target file side by side, then reconcile layout, spacing scale, type sizes/weights, colours, border/radius, button styles, and copy to match — keeping the existing component logic.
- Keep components self-contained the way they are now (local `StyleSheet` named `s`, `{ navigate }` props). Match the existing code style.
- Prefer editing existing files over adding new ones. Only add a file if a mockup genuinely calls for a new screen *and* I've approved it.

## Per-screen fidelity check

For each screen, confirm: header/title hierarchy ✓ · spacing rhythm ✓ · colours from tokens ✓ · primary vs secondary vs text actions styled as designed ✓ · empty/loading/error states still present and on-brand ✓ · copy matches the mockup ✓ · privacy: no leaked names/counts where forbidden ✓.

## When done

1. `pnpm typecheck && pnpm test` — both green (this keeps CI/CD functioning — an M2 row).
2. `pnpm dev:mobile` and click through the **whole loop, end to end** (Home → Suggest → Availability → Floating → The moment → "I'm in if…" → Reveal, plus the silent-fizzle path back to Home). The loop must stay **interlinked and clickable with no dead-ends** — that *interlinked core interaction* is exactly what the M2 mock-ups row grades. Confirm nothing regressed and every screen matches its mockup. If you can't run/inspect the UI, say so explicitly rather than claiming a visual match.
3. **Linear (per `CLAUDE.md`):** find or create the issue for this restyle, move it to In Progress at the start, log decisions/deviations as comments, mark it Done with the commit/PR when finished.
4. Branching: per `CLAUDE.md`, work on `dev` unless this is large enough to warrant a `feat/*` branch → PR into `dev`. Never push to `main`.
5. Report a short summary: which screens changed, any tokens/fonts/deps added, and any mockup details you deviated from (with the reason) or that need my decision.

## Flag back to me, don't guess

- A mockup that needs a new screen/route or a new API field.
- A mockup that breaks a privacy invariant or the flat aesthetic.
- Any image you can't confidently map to a screen.
