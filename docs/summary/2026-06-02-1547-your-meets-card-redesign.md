# Your Meets dashboard redesign: expanded cards + Action Required tray - 2026-06-02

**Branch:** dev | **PRs:** none opened this session (uncommitted working-tree changes) | **Scope:** Restyle the "Your meets" (Dashboard) screen - turn the cramped activity list into per-plan cards and add a colourful "Action required" zone at the top.

## TL;DR
This was a pure frontend/aesthetics iteration on the mobile **Dashboard** ("Your meets") screen, driven turn-by-turn by the user reacting to each draft. We replaced the old cramped single-`Card` hairline-row list with one full, breathing **`MeetCard`** per plan, then consolidated the two ad-hoc "needs your input" treatments (the loud pink `banner` + the single `featured` card) into one labelled, solid-pink **"Action required" tray** at the top of the screen. Status is now expressed through the existing neobrutalist sticker idiom (pink while a plan wants you, green once you're in) instead of soft pastel "badge" pills, which the user explicitly rejected as "vibe coded." Work is **uncommitted** on `dev`; `pnpm typecheck` and `biome` pass for the changed files, but nothing has been visually verified on a device yet.

## What was done

All changes are in `apps/mobile/src/screens/Dashboard.tsx` plus a one-line generalisation of `apps/mobile/src/ui/StickerTag.tsx`. (The other files in the working tree - `format.ts`, `CreateEvent.tsx`, `EventDetail.tsx`, `DateTimeField.*` - were already modified before this session and were NOT touched here; only Dashboard.tsx and StickerTag.tsx are this session's work.)

### 1. Expanded each list row into a full `MeetCard` (first request)
- **Before:** the activity list was a single `<Card padding={0}>` containing thin rows separated by hairlines - each row was `flexDirection: row` with a tiny 17px `StatusCheck` box, a 13px title, optional mini avatars, and a small right-edge `DateChip` (via a `rowRight()` helper). The user called this "quite ugly" and wanted each item "a lot bigger... expand each one, but keep it very well styled."
- **After:** introduced a `MeetCard` component - each plan is its own bordered, hard-shadowed card (the system's `Card`) with: a title (display font), a `groupName · location` subtitle, and a phase-aware footer (`CardFooter`) showing a mono `DateChip` on the left and either overlapping going-avatars + "N going" (cleared) or a contextual `Hint` (collecting / moment) on the right.
- Removed the now-unused `StatusCheck` import and the `rowRight()` helper.

### 2. First status treatment: soft-tint `StatusPill` - REJECTED
- The first draft put a colour-coded `StatusPill` at the top of each card: a dot + uppercase label (e.g. "YOU'RE IN", "PICK TIMES") on a **soft ~10% tint** of the status colour, built with `backgroundColor: ` + 8-digit hex alpha suffix (e.g. `${color}1A`).
- The user reacted strongly: *"remove the YOU'RE IN BADGE... STAY IN THEME ITS SO UGLY AND VIBE CODED. DESIGN WITH INTENTION."*
- **Lesson applied:** soft translucent pastel tints are exactly the "AI slop" tell and are **foreign to neobrutalism**, which is solid fills + ink borders + hard shadows + high contrast. Removed `StatusPill` and the `STATUS` map and the foreign hairline divider that had also been added inside the card.

### 3. Second status treatment: status lives in the sticker (accepted)
- Reframed: the screen already contained a card the user did NOT complain about - the **`featured`** card - which has no badge, just a title + a rotated solid `StickerTag` + meta + footer. So instead of inventing a status system, every `MeetCard` was rebuilt from the *same parts* as the featured card, so the screen reads as one designed set (list cards 16px display title vs featured's 18px, preserving hierarchy).
- Status is now carried by the sticker in the system's own idiom (solid fill, ink hard-shadow, 4° tilt) via a `cardSticker(e)` helper:
  - `collecting` -> pink `Which times?`
  - `moment` -> pink `Locks {countdown}`
  - `cleared` + `myStatus === "going"` -> **green** `You're in`
  - otherwise -> **no sticker** (absence is the signal)
- **Declined plans dim to `opacity: 0.6`** instead of wearing a grey label.
- Generalised `StickerTag` to accept an optional `color` prop (default `ui.brand` pink, so existing call sites are unchanged) - needed for the green "You're in" variant.

### 4. Added the "Action required" zone (third request)
- User: *"we should make sure to have an action required bit at the very top above the list."*
- Used `AskUserQuestion` (with ASCII-mockup previews) to resolve the one real structural fork. User chose **"Consolidate into one section."**
- Implemented:
  - New `actionItems` memo = every event waiting on ME to act: `(phase === "moment" && myStatus === "awaiting") || (phase === "collecting" && !iReacted)`. Sorted **live moments first** (ticking, by `msLeft` ascending), then collecting menus by `startsAt`.
  - New `actionIds` set; the `list` memo now excludes action items (`!actionIds.has(e.id)`) then applies the status-tab filter. So action items **lift out** of the archive - no duplication.
  - **Removed** the bespoke full-pink `banner` block and the entire `featured` card block - both folded into the one section.

### 5. Made the Action Required zone a "colourful box" (fourth request)
- User: *"let's put the action required in a colourful box and also the number thing isnt centred inside of it. font too small for 'action required' think more about stylin!"*
- Implemented a **solid pink (`ui.brand`) tray** wrapping the whole section: `HardShadow` + 2px ink border + `borderRadius: ui.rCard` + `padding: 12`. The white `MeetCard`s float on it like tickets on a tray.
  - Rationale grounded in `theme.ts`: `brand: "#FF5CA8" // pink: urgent + primary`. The urgent zone IS the pink zone - semantically exact, not a random colour.
- **"ACTION REQUIRED"** heading bumped from the 9px overline to `font.black` (Archivo 900) **16px white uppercase**.
- New `CountBadge` component: fixed 26px circle, `ui.surface` (white) fill + ink border (pops on pink), number centred with `includeFontPadding: false` + explicit `lineHeight: 14` + `textAlign: "center"` to kill RN's baseline drift (the original off-centre bug).
- `MeetCard` gained an optional `last` prop; the final card in the tray drops its `marginBottom` so tray padding stays even.
- Removed the interim `SectionLabel` helper (superseded by the inline tray + `CountBadge`).

## Key decisions & rationale

| Decision | Alternatives weighed | Why this won |
|---|---|---|
| Stay inside the existing **refined-neobrutalist** system (DRP-25), do not invent a new aesthetic | New bespoke look | The codebase has a strong, intentional design language (hard shadows, 2px ink borders, Archivo display, hot-pink brand, mono numerals). User wanted "well styled" + "stay in theme," not novelty. |
| Status via **solid sticker**, not a badge pill | Soft-tint pastel pill; left colour spine/rail; reusing the `StatusCheck` glyph | Pills were explicitly rejected as slop. Solid + ink-shadow + tilt is the system's own vocabulary. The `featured` card already proved this pattern works. |
| **Pink** for the Action Required tray | A new accent colour (amber/blue/purple); green; soft pink tint | `theme.ts` literally defines pink as "urgent + primary." Urgent zone = pink zone is semantically correct and avoids introducing an off-system colour. |
| **Consolidate** banner + featured into one labelled section, lifting items OUT of the list | (a) Keep loud banner + separate section; (b) compact pinned strip that duplicates urgent items into the list too | User picked consolidation. Cleanest IA: one place for "what needs me," zero duplication. Nice side effect: the **"Awaiting" tab now cleanly means "waiting on the group"** (plans you've already responded to), distinct from "waiting on you" up top. |
| Make `MeetCard` a true **sibling** of the featured card (same parts, slightly smaller) | A visually distinct list-card design | Cohesion - the whole screen reads as one set; preserves a banner > featured > list visual hierarchy (now: tray > archive cards). |
| Declined = `opacity: 0.6`, no label | A grey "Declined" sticker/badge | Absence/dimming is a cleaner signal than another badge; declined items are behind a tab anyway. |

## Things learned / discovered
- **Data shape** for the list comes from `trpc.events.mine.query()` (`apps/api/src/routers/events.ts` ~line 306-374). Per-event fields used: `id, groupName, title, location, whenMode, phase ("collecting"|"moment"|"cleared"), startsAt, momentEndsAt, msLeft, myStatus ("going"|"awaiting"|"declined"|"reacting"), iReacted, candidateCount, isCreator, readyToLock, goingCount, goingPreview[{uid, initial, color}]`. Note `fizzled` events are filtered out server-side (silent).
- **`goingCount` is nullable** in the inferred type - `tsc` flagged `'e.goingCount' is possibly 'null'` on a `> 0` comparison. Fixed by using a truthiness check (`e.goingCount ?`) which both narrows and reads fine.
- **RN count-badge centring quirk:** `alignItems/justifyContent: center` alone does not vertically centre text in a small circle because of font padding/baseline (especially Android). Fix = `includeFontPadding: false` + explicit `lineHeight` + `textAlign: "center"` on the `Text`.
- **`StickerTag`** was hardcoded to `ui.brand`; adding an optional `color` prop (default `ui.brand`) is backward-compatible - the `featured`/other call sites render identically.
- **Status semantics** are encoded in `theme.ts` comments: `brand` pink = "urgent + primary", `going` green = "going + affirmative". These drove the colour choices (pink for action, green for "You're in").
- **`AskUserQuestion` previews:** ASCII mockups in option `preview` fields render side-by-side and were effective for letting the user pick a layout direction quickly.

## Current state
- **All work is uncommitted** on branch `dev`. Changed this session: `apps/mobile/src/screens/Dashboard.tsx` (+215/-145) and `apps/mobile/src/ui/StickerTag.tsx` (+/-4, added `color` prop).
- Other working-tree files (`format.ts`, `CreateEvent.tsx`, `EventDetail.tsx`, `DateTimeField.tsx/.types.ts/.web.tsx`) were already dirty before this session and were not part of this work.
- **Verified:** `pnpm --filter @bethere/mobile exec tsc --noEmit` passes; `pnpm exec biome check` passes for the two changed files.
- **NOT verified:** no device/simulator run yet. Offered to run `pnpm dev:mobile` each turn; user has not taken it up.
- **No Linear issue** was created/updated for this work (CLAUDE.md asks for religious Linear tracking via the DRP_02 team - this aesthetic iteration was done ad-hoc and should be back-filled if it matters).

### Final Dashboard structure (top -> bottom)
1. `Heading title="Your meets"`
2. Error text (if fetch failed)
3. If no groups: "No groups yet" card.
4. Else:
   - **Pink "Action required" tray** (only if `actionItems.length > 0`): bold white heading + white `CountBadge`, then `MeetCard`s (live moments first).
   - `Tabs` (`All / Going / Awaiting / Declined`).
   - The archive `list` of `MeetCard`s (everything not awaiting your action), or a "Nothing here yet." card.
5. Fixed-bottom `BigButton` ("Suggest a meetup" / "Create a group").

### Key components now in Dashboard.tsx
- `BigButton` (unchanged), `Hint`, `CardFooter`, `cardSticker`, `MeetCard` (now takes `{ e, onPress, last? }`), `CountBadge`, and the `Dashboard` screen with `actionItems` / `actionIds` / `list` memos and `matchesFilter`.

## Conventions, commands & workflows
- **Package manager: `pnpm` only.** Quality gates run this session:
  - `pnpm --filter @bethere/mobile exec tsc --noEmit` (mobile typecheck)
  - `pnpm exec biome check <files>` (lint)
  - Repo-wide before any PR: `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- **No em dashes** anywhere (code, comments, docs) - use hyphens. (Honoured in all new comments.)
- **Branching:** routine work commits straight to `dev`; never push/PR to `main` except `dev` -> `main`. This work is on `dev`, uncommitted.
- **Design system:** import `ui` and `font` from `apps/mobile/src/theme.ts`. Use `Card`, `HardShadow`, `StickerTag`, `DateChip`, `Avatar`, `Tabs`, `Heading` from `apps/mobile/src/ui`. Solid fills + ink borders + hard shadows; NO soft/translucent tint backgrounds.

## Known issues / caveats / risks
- **Not visually verified.** Layout, spacing, and the pink tray's overall "loudness" with multiple cards have only been reasoned about, not seen. Needs a device/Expo Go check.
- **Pink-on-pink stickers inside the tray:** action-item cards still carry their pink `Which times?` / `Locks 3:40` stickers while sitting on the pink tray. They're separated by the white card so they should read, but it's conceptually redundant. Flagged to the user as an easy toggle - could switch in-tray stickers to **ink/black** (keeping the countdown as the star) if it looks muddy live.
- **Repeated 4° sticker tilt** down a list of cards: could read as a deliberate motif or as noise. Worth eyeballing; easy to set to 0° or alternate.
- **Empty archive under a populated tray:** when every event is action-required, the archive shows "Nothing here yet." beneath the tabs. Mildly odd; could hide tabs/empty-state when the archive is empty (not done).
- **"Awaiting" tab meaning shifted** (now "waiting on the group" rather than "waiting on you"). This is intentional and arguably clearer, but the tab label/semantics were not otherwise updated - confirm it still reads right to users.

## Next steps
1. Run `pnpm dev:mobile` and visually verify on Expo Go (SDK 54) / simulator - especially the pink tray, count-badge centring, and card density.
2. Decide the in-tray sticker colour (keep pink vs switch to ink/black) once seen.
3. Optionally hide tabs + empty-state when the archive is empty.
4. Run repo-wide `pnpm lint && pnpm typecheck && pnpm test`, then commit to `dev` (suggested message theme: "feat(mobile): redesign Your Meets - expanded cards + Action Required tray"). Back-fill a Linear issue in team DRP_02 if tracking is required.
5. Consider whether the archive deserves its own section label for balance against the bold pink heading (deferred; tabs currently act as its header).

## References
- `apps/mobile/src/screens/Dashboard.tsx` - the screen redesigned this session.
- `apps/mobile/src/ui/StickerTag.tsx` - now accepts optional `color` prop.
- `apps/mobile/src/theme.ts` - the `ui`/`font` design tokens; colour semantics in comments (`brand` = urgent, `going` = affirmative).
- `apps/mobile/src/ui/` - `Card.tsx`, `HardShadow.tsx`, `DateChip.tsx`, `Avatar.tsx`, `Tabs.tsx`, `Heading.tsx`, `StatusCheck.tsx` (StatusCheck no longer used by Dashboard).
- `apps/mobile/src/lib/format.ts` - `formatTime`, `formatCountdown` used by the cards.
- `apps/api/src/routers/events.ts` (~L306) - `events.mine` query defining the `Ev` shape.
- `CLAUDE.md` - project conventions (pnpm only, no em dashes, branching, Linear tracking, Expo SDK 54 pin, convergence model).
- `ARCHITECTURE.md` - the convergence model (whenMode: exact/options/fuzzy; collecting -> moment -> cleared/fizzled).
- Prior context: PR #25 (DRP-25 refined-neobrutalist UX overhaul) established the design system this session builds on; PR #28 (M3 convergence model) is the current product model.
