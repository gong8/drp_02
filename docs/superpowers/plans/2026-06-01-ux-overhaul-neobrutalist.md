# UX Overhaul (Refined Neobrutalist) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the entire BeThere mobile app to the approved refined-neobrutalist system (peach-to-lavender gradient, white boxy cards, 2px outlines, hard offset shadows, tilted pink stickers, mono date chips, Archivo headings, pink+green accents), behind restyled bottom-tab navigation, with the "going" crowd revealed only after the respond-by timer ends.

**Architecture:** Add design tokens to `theme.ts` and a small primitive component library in `apps/mobile/src/ui/` (built once, composed by every screen). One pure, unit-tested helper in `@bethere/shared` gates the "going" reveal; `events.mine` returns `goingCount`/`goingPreview` only once an event is resolved. Screens keep their existing tRPC data hooks; only their rendered output and styles change.

**Tech Stack:** Expo SDK 54 (do NOT bump), React Native 0.81, React Navigation v7, tRPC v11, Zod, Drizzle, Postgres. New deps: `expo-linear-gradient`, `expo-font`, `@expo-google-fonts/{archivo,inter,space-mono}`. Tests: vitest (shared), node:test (api), jest-expo (mobile). pnpm only.

**Spec:** `docs/superpowers/specs/2026-06-01-ux-overhaul-visual-system-design.md`
**Visual source of truth:** `docs/mockups/m3-ux-overhaul/all-screens.html` (open in a browser and match intent: hierarchy, spacing, weight, colour).
**Linear:** [DRP-25](https://linear.app/drp-02/issue/DRP-25/ux-overhaul-refined-neobrutalist-visual-system-peach-to-lavender). Move to **In Progress** before Task 1; mark **Done** after Task 19.

**Locked decisions:** bottom tabs (restyled) - two accents (pink brand/urgent + green going) - Home is featured-card + filter-tabs + checklist - "+N going" and avatars appear only after the respond-by timer expires (enforced server-side).

**Conventions:** No em dashes anywhere (use hyphens). `apps/api` is ESM (relative imports need `.js`). Mobile imports `@bethere/api` type-only. Commit straight to `dev`. Run `pnpm lint && pnpm typecheck && pnpm test` before any PR.

**A note on testing rhythm:** the backend reveal rule is pure and gets real TDD (vitest). The mobile work is a presentational restyle; the repo has no RN render tests and `jest-expo` is configured only with a trivial smoke test. So mobile tasks are gated by `pnpm --filter @bethere/mobile typecheck` plus a manual click-through in Expo Go, and we keep the existing tests green. Do not invent brittle snapshot tests.

---

## File Structure

**Created**
- `apps/mobile/src/ui/HardShadow.tsx` - crisp offset shadow wrapper (RN shadows blur; this fakes `4px 4px 0`).
- `apps/mobile/src/ui/ScreenBackground.tsx` - full-screen gradient + safe-area padding.
- `apps/mobile/src/ui/Card.tsx` - white boxy card (border + hard shadow).
- `apps/mobile/src/ui/Button.tsx` - primary (pink) / affirmative (green) / outline.
- `apps/mobile/src/ui/Chip.tsx` - selectable pill (group picker).
- `apps/mobile/src/ui/Field.tsx` - labelled input/box.
- `apps/mobile/src/ui/Tabs.tsx` - Home status filter (active = black pill).
- `apps/mobile/src/ui/Toggle.tsx` - 2-option segmented control (sheet).
- `apps/mobile/src/ui/DateChip.tsx` - mono date chip.
- `apps/mobile/src/ui/StickerTag.tsx` - tilted pink sticker.
- `apps/mobile/src/ui/StatusCheck.tsx` - list status box (going/awaiting/declined).
- `apps/mobile/src/ui/SelectCheck.tsx` - pink selection check (sheet member picker).
- `apps/mobile/src/ui/Avatar.tsx` - bordered initial circle.
- `apps/mobile/src/ui/Heading.tsx` - overline + Archivo title + right slot.
- `apps/mobile/src/ui/BackBar.tsx` - boxy back button + title.
- `apps/mobile/src/ui/BottomSheet.tsx` - modal scrim + sheet shell.
- `apps/mobile/src/ui/index.ts` - barrel export.
- `packages/shared/src/logic/reveal.ts` - `revealGoing` pure helper.
- `packages/shared/src/logic/reveal.test.ts` - vitest tests for it.

**Modified**
- `apps/mobile/src/theme.ts` - add `ui` and `font` token objects (additive; remove legacy in Task 17).
- `apps/mobile/App.tsx` - load fonts; restyle bottom tabs; `headerShown:false` on stacks.
- `packages/shared/src/index.ts` - export `./logic/reveal.js`.
- `apps/api/src/routers/events.ts` - `mine` returns `goingCount`/`goingPreview` via `revealGoing`.
- `apps/mobile/src/screens/Dashboard.tsx` - featured + tabs + checklist.
- `apps/mobile/src/screens/EventDetail.tsx` - restyle RSVP + sheet.
- `apps/mobile/src/screens/CreateEvent.tsx` - restyle form.
- `apps/mobile/src/screens/GroupsList.tsx` - restyle rows.
- `apps/mobile/src/screens/GroupDetail.tsx` - restyle members.
- `apps/mobile/src/screens/CreateGroup.tsx` - restyle.

---

## Phase 0 - Foundations

### Task 1: Install dependencies

**Files:** `apps/mobile/package.json` (via installer)

- [ ] **Step 1: Install with Expo's resolver (keeps versions SDK-54-aligned, uses pnpm)**

Run:
```bash
pnpm --filter @bethere/mobile exec expo install expo-linear-gradient expo-font @expo-google-fonts/archivo @expo-google-fonts/inter @expo-google-fonts/space-mono
```
Expected: the packages are added to `apps/mobile/package.json` and installed. `expo install` picks versions compatible with SDK 54. Do NOT use `npm`/`yarn` and do NOT bump the Expo SDK.

- [ ] **Step 2: Verify install and types resolve**

Run: `pnpm --filter @bethere/mobile typecheck`
Expected: PASS (no missing-module errors for the new packages).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/package.json pnpm-lock.yaml
git commit -m "chore(mobile): add gradient + google fonts deps (DRP-25)"
```

### Task 2: Add design tokens to theme

**Files:** Modify `apps/mobile/src/theme.ts`

- [ ] **Step 1: Append the new token objects** (keep the existing `colors`/`status`/`space`/`radius` for now so current screens still compile)

Append to `apps/mobile/src/theme.ts`:
```ts
// Refined-neobrutalist design system (DRP-25). Legacy colours above are removed in Task 17
// once every screen has migrated to `ui`.
export const ui = {
  gradient: ["#FCEFE8", "#ECEAFF"] as [string, string],
  surface: "#FFFFFF",
  ink: "#111111",
  muted: "#7D7A86",
  hairline: "rgba(0,0,0,0.10)",
  scrim: "rgba(24,18,34,0.45)",
  brand: "#FF5CA8", // pink: urgent + primary
  going: "#34A853", // green: going + affirmative
  rCard: 18,
  rButton: 14,
  rInput: 12,
  rTab: 8,
  rChip: 999,
  rSmall: 6,
  border: 2,
  shadow: 4, // hard offset in px
} as const;

export const font = {
  display: "Archivo_800ExtraBold",
  black: "Archivo_900Black",
  body: "Inter_400Regular",
  medium: "Inter_500Medium",
  bold: "Inter_700Bold",
  mono: "SpaceMono_700Bold",
} as const;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @bethere/mobile typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/theme.ts
git commit -m "feat(mobile): add neobrutalist design tokens (DRP-25)"
```

### Task 3: Load fonts at app start

**Files:** Modify `apps/mobile/App.tsx`

- [ ] **Step 1: Add font loading at the top of `App()`**

In `apps/mobile/App.tsx`, add imports near the top:
```tsx
import { useFonts } from "expo-font";
import { Archivo_800ExtraBold, Archivo_900Black } from "@expo-google-fonts/archivo";
import { Inter_400Regular, Inter_500Medium, Inter_700Bold } from "@expo-google-fonts/inter";
import { SpaceMono_700Bold } from "@expo-google-fonts/space-mono";
import { View } from "react-native";
```
Then inside `export default function App() {`, before the `return`:
```tsx
const [fontsLoaded] = useFonts({
  Archivo_800ExtraBold,
  Archivo_900Black,
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
  SpaceMono_700Bold,
});
if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: "#FCEFE8" }} />;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @bethere/mobile typecheck`
Expected: PASS.

- [ ] **Step 3: Run and confirm the app still boots**

Run: `pnpm dev:mobile` and open in Expo Go.
Expected: app loads (brief peach splash while fonts load, then the current screens). Stop the dev server when confirmed.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/App.tsx
git commit -m "feat(mobile): load Archivo/Inter/Space Mono fonts (DRP-25)"
```

---

## Phase 1 - Backend: reveal "going" only after the timer

### Task 4: `revealGoing` pure helper (TDD)

**Files:**
- Create: `packages/shared/src/logic/reveal.ts`
- Test: `packages/shared/src/logic/reveal.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/logic/reveal.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ResponseInput } from "./resolve.js";
import { revealGoing } from "./reveal.js";

const yes = (userId: string): ResponseInput => ({ userId, kind: "yes" });

describe("revealGoing", () => {
  it("hides the crowd while the respond-by timer is still running", () => {
    expect(revealGoing([yes("a")], { respondByAtMs: 1000, status: "open", nowMs: 500 })).toBeNull();
  });

  it("reveals the IN set once respond-by has passed", () => {
    expect(
      revealGoing([yes("a"), yes("b")], { respondByAtMs: 1000, status: "open", nowMs: 2000 })?.sort(),
    ).toEqual(["a", "b"]);
  });

  it("reveals immediately when the event is already resolved", () => {
    expect(revealGoing([yes("a")], { respondByAtMs: 9999, status: "resolved", nowMs: 0 })).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bethere/shared exec vitest run src/logic/reveal.test.ts`
Expected: FAIL with "Cannot find module './reveal.js'" / `revealGoing is not a function`.

- [ ] **Step 3: Implement the helper**

Create `packages/shared/src/logic/reveal.ts`:
```ts
import { type ResponseInput, resolveIn } from "./resolve.js";

// The "going" crowd is hidden until the respond-by timer ends (or the event is locked), so a
// pending event shows its countdown instead of biasing people with who is already in. Returns
// the IN userIds once revealed, or null while still pending.
export function revealGoing(
  responses: ResponseInput[],
  opts: { respondByAtMs: number; status: string; nowMs: number },
): string[] | null {
  const resolved = opts.nowMs > opts.respondByAtMs || opts.status === "resolved";
  if (!resolved) return null;
  return [...resolveIn(responses)];
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, add a line:
```ts
export * from "./logic/reveal.js";
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @bethere/shared exec vitest run src/logic/reveal.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/logic/reveal.ts packages/shared/src/logic/reveal.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): revealGoing - gate the going crowd on the respond-by timer (DRP-25)"
```

### Task 5: `events.mine` returns goingCount/goingPreview

**Files:** Modify `apps/api/src/routers/events.ts`

- [ ] **Step 1: Import the helper**

In `apps/api/src/routers/events.ts`, add `revealGoing` to the existing `@bethere/shared` import:
```ts
import {
  CreateEventInput,
  ResolveInput,
  RespondInput,
  type ResponseInput,
  resolveIn,
  revealGoing,
} from "@bethere/shared";
```

- [ ] **Step 2: Compute and return the reveal inside `mine`**

In the `mine` query, replace the `rows.map(async (e) => { ... })` body (currently returning `{ id, groupName, title, location, startsAt, respondByAt, myStatus }`) with:
```ts
rows.map(async (e) => {
  const [g] = await db.select().from(groups).where(eq(groups.id, e.groupId));
  const resp = await responsesFor(e.id);
  const revealed = revealGoing(resp, {
    respondByAtMs: e.respondByAt.getTime(),
    status: e.status,
    nowMs: Date.now(),
  });
  let goingCount: number | null = null;
  const goingPreview: { color: string; initial: string }[] = [];
  if (revealed) {
    goingCount = revealed.length;
    for (const uid of revealed.slice(0, 4)) {
      const [u] = await db.select().from(users).where(eq(users.id, uid));
      goingPreview.push({
        color: u?.avatarColor ?? "#8B948B",
        initial: (u?.name ?? "?").charAt(0).toUpperCase(),
      });
    }
  }
  return {
    id: e.id,
    groupName: g?.name ?? "Group",
    title: e.title,
    location: e.location,
    startsAt: e.startsAt.toISOString(),
    respondByAt: e.respondByAt.toISOString(),
    myStatus: statusFor(ctx.userId, resp),
    goingCount, // number once the timer has passed, else null
    goingPreview, // up to 4 {color, initial}, empty while pending
  };
}),
```

- [ ] **Step 3: Typecheck the API and shared**

Run: `pnpm --filter @bethere/api typecheck && pnpm --filter @bethere/shared typecheck`
Expected: PASS. (The mobile client picks up `goingCount`/`goingPreview` automatically via the type chain.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routers/events.ts
git commit -m "feat(api): events.mine returns goingCount/goingPreview after the timer (DRP-25)"
```

---

## Phase 2 - UI primitives (`apps/mobile/src/ui/`)

> Each primitive is small and presentational. Gate each task with `pnpm --filter @bethere/mobile typecheck`. Match the look in `docs/mockups/m3-ux-overhaul/all-screens.html`.

### Task 6: HardShadow + ScreenBackground

**Files:** Create `apps/mobile/src/ui/HardShadow.tsx`, `apps/mobile/src/ui/ScreenBackground.tsx`

- [ ] **Step 1: HardShadow**

Create `apps/mobile/src/ui/HardShadow.tsx`:
```tsx
import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { ui } from "../theme";

// RN shadows are blurred and Android elevation cannot offset, so we fake the `4px 4px 0`
// neobrutalist shadow with a solid ink rectangle the same size as the child, shifted by `offset`.
export function HardShadow({
  children,
  radius = ui.rCard,
  offset = ui.shadow,
  color = ui.ink,
  style,
}: {
  children: ReactNode;
  radius?: number;
  offset?: number;
  color?: string;
  style?: ViewStyle;
}) {
  return (
    <View style={style}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: offset,
          left: offset,
          right: -offset,
          bottom: -offset,
          backgroundColor: color,
          borderRadius: radius,
        }}
      />
      {children}
    </View>
  );
}
```

- [ ] **Step 2: ScreenBackground**

Create `apps/mobile/src/ui/ScreenBackground.tsx`:
```tsx
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ui } from "../theme";

// Full-screen peach-to-lavender gradient behind every screen, with safe-area top padding.
export function ScreenBackground({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient colors={ui.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}>{children}</View>
    </LinearGradient>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bethere/mobile typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/ui/HardShadow.tsx apps/mobile/src/ui/ScreenBackground.tsx
git commit -m "feat(mobile): HardShadow + ScreenBackground primitives (DRP-25)"
```

### Task 7: Card, Button, Chip

**Files:** Create `apps/mobile/src/ui/Card.tsx`, `Button.tsx`, `Chip.tsx`

- [ ] **Step 1: Card**

Create `apps/mobile/src/ui/Card.tsx`:
```tsx
import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { ui } from "../theme";
import { HardShadow } from "./HardShadow";

export function Card({
  children,
  padding = 12,
  radius = ui.rCard,
  style,
}: {
  children: ReactNode;
  padding?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  return (
    <HardShadow radius={radius} style={style}>
      <View
        style={{
          backgroundColor: ui.surface,
          borderWidth: ui.border,
          borderColor: ui.ink,
          borderRadius: radius,
          padding,
        }}
      >
        {children}
      </View>
    </HardShadow>
  );
}
```

- [ ] **Step 2: Button** (primary pink / affirmative green / outline)

Create `apps/mobile/src/ui/Button.tsx`:
```tsx
import { Pressable, Text, type ViewStyle } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

type Variant = "primary" | "affirmative" | "outline";

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg = variant === "primary" ? ui.brand : variant === "affirmative" ? ui.going : ui.surface;
  const fg = variant === "outline" ? ui.ink : "#fff";
  return (
    <HardShadow radius={ui.rButton} style={[{ opacity: disabled ? 0.45 : 1 }, style]}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        style={{
          backgroundColor: bg,
          borderWidth: ui.border,
          borderColor: ui.ink,
          borderRadius: ui.rButton,
          paddingVertical: 13,
          alignItems: "center",
        }}
      >
        <Text style={{ fontFamily: font.display, fontSize: 14, color: fg }}>{label}</Text>
      </Pressable>
    </HardShadow>
  );
}
```

- [ ] **Step 3: Chip** (group picker; selected = black fill)

Create `apps/mobile/src/ui/Chip.tsx`:
```tsx
import { Pressable, Text } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

export function Chip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <HardShadow radius={ui.rChip} offset={2} style={{ marginRight: 8, marginBottom: 8 }}>
      <Pressable
        onPress={onPress}
        style={{
          backgroundColor: selected ? ui.ink : ui.surface,
          borderWidth: ui.border,
          borderColor: ui.ink,
          borderRadius: ui.rChip,
          paddingVertical: 6,
          paddingHorizontal: 12,
        }}
      >
        <Text style={{ fontFamily: font.bold, fontSize: 12, color: selected ? "#fff" : ui.ink }}>{label}</Text>
      </Pressable>
    </HardShadow>
  );
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter @bethere/mobile typecheck` (Expected: PASS)
```bash
git add apps/mobile/src/ui/Card.tsx apps/mobile/src/ui/Button.tsx apps/mobile/src/ui/Chip.tsx
git commit -m "feat(mobile): Card, Button, Chip primitives (DRP-25)"
```

### Task 8: Field, Tabs, Toggle, DateChip, StickerTag

**Files:** Create `Field.tsx`, `Tabs.tsx`, `Toggle.tsx`, `DateChip.tsx`, `StickerTag.tsx` in `apps/mobile/src/ui/`

- [ ] **Step 1: Field** (labelled box; editable or read-only)

Create `apps/mobile/src/ui/Field.tsx`:
```tsx
import type { ReactNode } from "react";
import { Text, TextInput, View, type ViewStyle } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  editable = true,
  right,
  style,
}: {
  label: string;
  value: string;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  editable?: boolean;
  right?: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={style}>
      <Text style={{ fontFamily: font.bold, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: ui.ink, marginBottom: 5 }}>
        {label}
      </Text>
      <HardShadow radius={ui.rInput} offset={3}>
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: ui.surface, borderWidth: ui.border, borderColor: ui.ink, borderRadius: ui.rInput, paddingHorizontal: 11 }}>
          <TextInput
            style={{ flex: 1, fontFamily: font.medium, fontSize: 13, color: ui.ink, paddingVertical: 10, minHeight: multiline ? 64 : undefined }}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={ui.muted}
            multiline={multiline}
            editable={editable}
          />
          {right}
        </View>
      </HardShadow>
    </View>
  );
}
```

- [ ] **Step 2: Tabs** (Home filter; active = black pill)

Create `apps/mobile/src/ui/Tabs.tsx`:
```tsx
import { Pressable, Text, View } from "react-native";
import { font, ui } from "../theme";

export function Tabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 7, marginBottom: 12 }}>
      {options.map((opt) => {
        const on = opt === value;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={{ backgroundColor: on ? ui.ink : "transparent", borderRadius: ui.rTab, paddingVertical: 5, paddingHorizontal: 11 }}
          >
            <Text style={{ fontFamily: font.bold, fontSize: 11, color: on ? "#fff" : ui.muted }}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 3: Toggle** (2-option segmented, sheet)

Create `apps/mobile/src/ui/Toggle.tsx`:
```tsx
import { Pressable, Text, View } from "react-native";
import { font, ui } from "../theme";

export function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly [T, T];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: "row", borderWidth: ui.border, borderColor: ui.ink, borderRadius: ui.rInput, overflow: "hidden" }}>
      {options.map((opt) => {
        const on = opt === value;
        return (
          <Pressable key={opt} onPress={() => onChange(opt)} style={{ flex: 1, alignItems: "center", paddingVertical: 8, backgroundColor: on ? ui.ink : ui.surface }}>
            <Text style={{ fontFamily: font.bold, fontSize: 11, color: on ? "#fff" : ui.muted }}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 4: DateChip + StickerTag**

Create `apps/mobile/src/ui/DateChip.tsx`:
```tsx
import { Text } from "react-native";
import { font, ui } from "../theme";

export function DateChip({ children, small = false }: { children: string; small?: boolean }) {
  return (
    <Text
      style={{
        fontFamily: font.mono,
        fontSize: small ? 9 : 10,
        color: ui.ink,
        borderWidth: 1,
        borderColor: ui.ink,
        borderRadius: ui.rSmall,
        paddingHorizontal: 7,
        paddingVertical: 3,
        overflow: "hidden",
      }}
    >
      {children}
    </Text>
  );
}
```
Create `apps/mobile/src/ui/StickerTag.tsx`:
```tsx
import { Text } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

export function StickerTag({ label }: { label: string }) {
  return (
    <HardShadow radius={ui.rSmall} offset={2} style={{ transform: [{ rotate: "4deg" }] }}>
      <Text style={{ fontFamily: font.mono, fontSize: 9, color: "#fff", backgroundColor: ui.brand, borderRadius: ui.rSmall, paddingHorizontal: 7, paddingVertical: 3, overflow: "hidden" }}>
        {label}
      </Text>
    </HardShadow>
  );
}
```

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @bethere/mobile typecheck` (Expected: PASS)
```bash
git add apps/mobile/src/ui/Field.tsx apps/mobile/src/ui/Tabs.tsx apps/mobile/src/ui/Toggle.tsx apps/mobile/src/ui/DateChip.tsx apps/mobile/src/ui/StickerTag.tsx
git commit -m "feat(mobile): Field, Tabs, Toggle, DateChip, StickerTag primitives (DRP-25)"
```

### Task 9: StatusCheck, SelectCheck, Avatar, Heading, BackBar, BottomSheet, barrel

**Files:** Create `StatusCheck.tsx`, `SelectCheck.tsx`, `Avatar.tsx`, `Heading.tsx`, `BackBar.tsx`, `BottomSheet.tsx`, `index.ts`

- [ ] **Step 1: StatusCheck + SelectCheck**

Create `apps/mobile/src/ui/StatusCheck.tsx`:
```tsx
import { Text, View } from "react-native";
import { ui } from "../theme";

// Home list status: going = green check, awaiting = empty box, declined = muted x.
export function StatusCheck({ status }: { status: "going" | "awaiting" | "declined" }) {
  const on = status === "going";
  return (
    <View
      style={{
        width: 17,
        height: 17,
        borderRadius: 5,
        borderWidth: 1.5,
        borderColor: on ? ui.going : ui.ink,
        backgroundColor: on ? ui.going : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on && <Text style={{ fontSize: 10, color: "#fff" }}>{"✓"}</Text>}
      {status === "declined" && <Text style={{ fontSize: 10, color: ui.muted }}>{"×"}</Text>}
    </View>
  );
}
```
Create `apps/mobile/src/ui/SelectCheck.tsx`:
```tsx
import { Text, View } from "react-native";
import { ui } from "../theme";

// Pink selection check used in the "I'll go if..." member picker.
export function SelectCheck({ selected }: { selected: boolean }) {
  return (
    <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: selected ? ui.brand : ui.ink, backgroundColor: selected ? ui.brand : "transparent", alignItems: "center", justifyContent: "center" }}>
      {selected && <Text style={{ fontSize: 11, color: "#fff" }}>{"✓"}</Text>}
    </View>
  );
}
```

- [ ] **Step 2: Avatar**

Create `apps/mobile/src/ui/Avatar.tsx`:
```tsx
import { Text, View } from "react-native";
import { font, ui } from "../theme";

export function Avatar({ initial, color, size = 32 }: { initial: string; color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: ui.border, borderColor: ui.ink, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: font.display, fontSize: size * 0.38, color: "#fff" }}>{initial}</Text>
    </View>
  );
}
```

- [ ] **Step 3: Heading + BackBar**

Create `apps/mobile/src/ui/Heading.tsx`:
```tsx
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { font, ui } from "../theme";

export function Heading({ overline, title, right }: { overline?: string; title: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 13 }}>
      <View style={{ flex: 1 }}>
        {overline ? (
          <Text style={{ fontFamily: font.bold, fontSize: 9, letterSpacing: 1.4, textTransform: "uppercase", color: ui.ink }}>{overline}</Text>
        ) : null}
        <Text style={{ fontFamily: font.black, fontSize: 27, letterSpacing: -1, color: ui.ink, marginTop: 3 }}>{title}</Text>
      </View>
      {right}
    </View>
  );
}
```
Create `apps/mobile/src/ui/BackBar.tsx`:
```tsx
import { Pressable, Text, View } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

export function BackBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <HardShadow radius={9} offset={3}>
        <Pressable onPress={onBack} style={{ width: 32, height: 32, borderRadius: 9, borderWidth: ui.border, borderColor: ui.ink, backgroundColor: ui.surface, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink, marginTop: -2 }}>{"‹"}</Text>
        </Pressable>
      </HardShadow>
      <Text style={{ fontFamily: font.display, fontSize: 15, color: ui.ink }}>{title}</Text>
    </View>
  );
}
```

- [ ] **Step 4: BottomSheet**

Create `apps/mobile/src/ui/BottomSheet.tsx`:
```tsx
import type { ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import { ui } from "../theme";

export function BottomSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: ui.scrim }} onPress={onClose} />
      <View
        style={{
          backgroundColor: ui.surface,
          borderTopWidth: ui.border,
          borderLeftWidth: ui.border,
          borderRightWidth: ui.border,
          borderColor: ui.ink,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          padding: 16,
          paddingBottom: 28,
        }}
      >
        <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: ui.ink, opacity: 0.25, alignSelf: "center", marginBottom: 14 }} />
        {children}
      </View>
    </Modal>
  );
}
```

- [ ] **Step 5: Barrel export**

Create `apps/mobile/src/ui/index.ts`:
```ts
export { Avatar } from "./Avatar";
export { BackBar } from "./BackBar";
export { BottomSheet } from "./BottomSheet";
export { Button } from "./Button";
export { Card } from "./Card";
export { Chip } from "./Chip";
export { DateChip } from "./DateChip";
export { Field } from "./Field";
export { HardShadow } from "./HardShadow";
export { Heading } from "./Heading";
export { ScreenBackground } from "./ScreenBackground";
export { SelectCheck } from "./SelectCheck";
export { StatusCheck } from "./StatusCheck";
export { StickerTag } from "./StickerTag";
export { Tabs } from "./Tabs";
export { Toggle } from "./Toggle";
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @bethere/mobile typecheck` (Expected: PASS)
```bash
git add apps/mobile/src/ui
git commit -m "feat(mobile): status/avatar/heading/backbar/sheet primitives + barrel (DRP-25)"
```

---

## Phase 3 - Screens and navigation

> For every screen task: keep the existing tRPC data hooks (queries, mutations, loading/error/empty states) intact; replace only the rendered output and `StyleSheet`. After each, run `pnpm --filter @bethere/mobile typecheck` and click the screen in Expo Go against `docs/mockups/m3-ux-overhaul/all-screens.html`.

### Task 10: Restyle navigation in App.tsx

**Files:** Modify `apps/mobile/App.tsx`

- [ ] **Step 1: Hide native stack headers** (we use the in-screen `BackBar` instead)

In `apps/mobile/App.tsx`, in `stackHeader`, set `headerShown: false` and drop the now-unused header colour props:
```tsx
const stackHeader = {
  headerShown: false,
  contentStyle: { backgroundColor: "transparent" },
} as const;
```
Remove the per-screen `options={{ title: ... }}` only if they cause unused-var lint; titles are harmless to leave. Keep all `<Stack.Screen>` entries and the component wiring exactly as they are.

- [ ] **Step 2: Restyle the bottom tab bar**

Replace the `<Tab.Navigator screenOptions={{...}}>` props with:
```tsx
<Tab.Navigator
  screenOptions={{
    headerShown: false,
    sceneStyle: { backgroundColor: "transparent" },
    tabBarActiveTintColor: ui.brand,
    tabBarInactiveTintColor: ui.muted,
    tabBarStyle: { backgroundColor: ui.surface, borderTopWidth: 2, borderTopColor: ui.ink, height: 58 },
    tabBarLabelStyle: { fontFamily: font.display, fontSize: 12 },
    tabBarIconStyle: { display: "none" },
  }}
>
```
Update the import line `import { colors } from "./src/theme";` to `import { font, ui } from "./src/theme";`. (If `colors` is still referenced elsewhere in App.tsx after this edit, keep it in the import; Task 17 removes it.)

- [ ] **Step 3: Typecheck + manual + commit**

Run: `pnpm --filter @bethere/mobile typecheck` (Expected: PASS)
Run: `pnpm dev:mobile`, confirm the bottom bar shows Meetups/Groups with a pink active label and a 2px top border, and screens render on the gradient (screens get their gradient in their own tasks). Stop the server.
```bash
git add apps/mobile/App.tsx
git commit -m "feat(mobile): restyle bottom tabs, hide stack headers (DRP-25)"
```

### Task 11: Dashboard (Home)

**Files:** Modify `apps/mobile/src/screens/Dashboard.tsx`

- [ ] **Step 1: Rewrite the screen** (featured card + filter tabs + checklist; reveal "+N going" only when `goingCount` is non-null)

Replace the entire contents of `apps/mobile/src/screens/Dashboard.tsx` with:
```tsx
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { countdown, formatTime } from "../lib/format";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { Avatar, Card, DateChip, Heading, ScreenBackground, StatusCheck, StickerTag, Tabs } from "../ui";

type Ev = Awaited<ReturnType<typeof trpc.events.mine.query>>[number];
type Props = NativeStackScreenProps<MeetupsStackParams, "Dashboard">;
const FILTERS = ["All", "Going", "Awaiting"] as const;
type Filter = (typeof FILTERS)[number];

export function Dashboard({ navigation }: Props) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("All");

  useFocusEffect(
    useCallback(() => {
      let active = true;
      trpc.events.mine
        .query()
        .then((e) => active && setEvents(e))
        .catch(() => active && setError(true))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, []),
  );

  // Featured = the soonest meet still awaiting my response.
  const featured = useMemo(() => {
    return [...events]
      .filter((e) => e.myStatus === "awaiting")
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];
  }, [events]);

  const list = useMemo(() => {
    const rest = events.filter((e) => e.id !== featured?.id);
    const matches = (e: Ev) =>
      filter === "All" || (filter === "Going" ? e.myStatus === "going" : e.myStatus === "awaiting");
    return rest
      .filter(matches)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [events, featured, filter]);

  if (loading) {
    return (
      <ScreenBackground>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={ui.ink} />
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <Heading
          overline={`${events.length} this week`}
          title="Your meets"
          right={<Avatar initial="A" color={ui.muted} size={28} />}
        />

        {error && <Text style={{ fontFamily: font.medium, color: ui.muted, marginBottom: 12 }}>Couldn't reach the server.</Text>}

        {featured && (
          <Pressable onPress={() => navigation.navigate("EventDetail", { eventId: featured.id })}>
            <Card style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontFamily: font.display, fontSize: 18, color: ui.ink }}>{featured.title}</Text>
                <StickerTag label={`RSVP ${countdown(featured.respondByAt)}`} />
              </View>
              <Text style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted, marginTop: 2 }}>
                {featured.groupName} {"·"} {featured.location}
              </Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 11 }}>
                <DateChip>{formatTime(featured.startsAt)}</DateChip>
                {featured.goingCount === null ? (
                  <Text style={{ fontFamily: font.medium, fontSize: 9, color: ui.muted }}>Who's in shows after the timer</Text>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    {featured.goingPreview.map((p, i) => (
                      <View key={`${p.initial}-${i}`} style={{ marginLeft: i === 0 ? 0 : -6 }}>
                        <Avatar initial={p.initial} color={p.color} size={18} />
                      </View>
                    ))}
                    <Text style={{ fontFamily: font.bold, fontSize: 9, color: ui.muted, marginLeft: 5 }}>+{featured.goingCount} going</Text>
                  </View>
                )}
              </View>
            </Card>
          </Pressable>
        )}

        <Tabs options={FILTERS} value={filter} onChange={setFilter} />

        <Card padding={0}>
          <Pressable
            onPress={() => navigation.navigate("CreateEvent")}
            style={{ flexDirection: "row", alignItems: "center", padding: 11, borderBottomWidth: 1, borderBottomColor: ui.ink, borderStyle: "dashed" }}
          >
            <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted }}>Suggest a meet...</Text>
            <View style={{ marginLeft: "auto", width: 24, height: 24, borderRadius: 7, borderWidth: 1, borderColor: ui.ink, backgroundColor: ui.brand, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: font.display, fontSize: 14, color: "#fff", marginTop: -1 }}>+</Text>
            </View>
          </Pressable>
          {list.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => navigation.navigate("EventDetail", { eventId: e.id })}
              style={{ flexDirection: "row", alignItems: "center", gap: 9, padding: 11, borderTopWidth: 1, borderTopColor: ui.hairline }}
            >
              <StatusCheck status={e.myStatus} />
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{e.title}</Text>
              <View style={{ marginLeft: "auto" }}>
                <DateChip small>{formatTime(e.startsAt)}</DateChip>
              </View>
            </Pressable>
          ))}
          {list.length === 0 && (
            <Text style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted, padding: 14, textAlign: "center" }}>Nothing here yet.</Text>
          )}
        </Card>
      </ScrollView>
    </ScreenBackground>
  );
}
```

- [ ] **Step 2: Typecheck + manual + commit**

Run: `pnpm --filter @bethere/mobile typecheck` (Expected: PASS)
Manually verify in Expo Go: featured card shows the countdown sticker (and "Who's in shows after the timer") while pending; tabs filter the checklist; tapping rows opens the event; tapping the add row opens Create. Compare to mockup screen 1.
```bash
git add apps/mobile/src/screens/Dashboard.tsx
git commit -m "feat(mobile): restyle Home - featured + tabs + checklist (DRP-25)"
```

### Task 12: EventDetail + the "I'll go if..." sheet

**Files:** Modify `apps/mobile/src/screens/EventDetail.tsx`

- [ ] **Step 1: Rewrite the screen** (keep the existing `load`/`answer` logic and state; restyle the respond actions, the who's-going list, and the conditional sheet)

Replace the entire contents of `apps/mobile/src/screens/EventDetail.tsx` with:
```tsx
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { countdown, formatDate, formatTime } from "../lib/format";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { Avatar, BackBar, BottomSheet, Button, Card, DateChip, ScreenBackground, SelectCheck, StickerTag, Toggle } from "../ui";

type Detail = NonNullable<Awaited<ReturnType<typeof trpc.events.get.query>>>;
type Member = Detail["members"][number];
type Mode = "At least one" | "All of them";
type Props = NativeStackScreenProps<MeetupsStackParams, "EventDetail">;

export function EventDetail({ route, navigation }: Props) {
  const { eventId } = route.params;
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [mode, setMode] = useState<Mode>("At least one");
  const [picked, setPicked] = useState<string[]>([]);

  const load = useCallback(() => {
    return trpc.events.get
      .query({ id: eventId })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [eventId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function answer(kind: "yes" | "no" | "conditional", cond?: { mode: "all" | "any"; targetIds: string[] }) {
    if (busy) return;
    setBusy(true);
    try {
      await trpc.events.respond.mutate(cond ? { eventId, kind, cond } : { eventId, kind });
      setEditing(false);
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <ScreenBackground>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={ui.ink} />
        </View>
      </ScreenBackground>
    );
  }
  if (error || !data) {
    return (
      <ScreenBackground>
        <View style={{ padding: 16 }}>
          <BackBar title="Back" onBack={() => navigation.goBack()} />
          <Text style={{ fontFamily: font.medium, color: ui.muted }}>{error ? "Couldn't reach the server." : "Event not found."}</Text>
        </View>
      </ScreenBackground>
    );
  }

  const showRespond = editing || (!data.myResponse && !data.resolved);
  const statusLine = data.myStatus === "going" ? "You're going" : data.myStatus === "declined" ? "You can't make it" : "Awaiting your response";

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        <BackBar title={data.groupName} onBack={() => navigation.goBack()} />

        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <DateChip>{formatDate(data.startsAt)}</DateChip>
            {!data.resolved && <StickerTag label={countdown(data.respondByAt)} />}
          </View>
          <Text style={{ fontFamily: font.display, fontSize: 22, color: ui.ink, marginTop: 8 }}>{data.title}</Text>
          <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 2 }}>
            {data.location} {"·"} {formatTime(data.startsAt)}
          </Text>
          {data.description ? <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 6 }}>{data.description}</Text> : null}
        </Card>

        {showRespond ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontFamily: font.display, fontSize: 14, color: ui.ink, marginBottom: 10 }}>Are you in?</Text>
            <Button label={"✓  I'm in"} variant="affirmative" disabled={busy} onPress={() => answer("yes")} style={{ marginBottom: 10 }} />
            <Button label="I'll go if..." variant="outline" disabled={busy} onPress={() => { setPicked([]); setSheet(true); }} style={{ marginBottom: 10 }} />
            <Button label="Can't make it" variant="outline" disabled={busy} onPress={() => answer("no")} />
          </View>
        ) : (
          <View style={{ marginTop: 16 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontFamily: font.bold, fontSize: 14, color: ui.ink }}>{statusLine}</Text>
              {!data.resolved && (
                <Pressable onPress={() => setEditing(true)}>
                  <Text style={{ fontFamily: font.bold, fontSize: 12, color: ui.brand }}>Change</Text>
                </Pressable>
              )}
            </View>
            <Text style={{ fontFamily: font.bold, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: ui.muted, marginBottom: 8 }}>Who's going</Text>
            <Card padding={0}>
              {data.going.map((p, i) => (
                <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: ui.hairline }}>
                  <Avatar initial={p.name.charAt(0).toUpperCase()} color={p.color} size={26} />
                  <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{p.name}</Text>
                  <Text style={{ marginLeft: "auto", color: ui.going }}>{"✓"}</Text>
                </View>
              ))}
              {data.going.length === 0 && <Text style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted, padding: 14 }}>No one's confirmed yet.</Text>}
            </Card>
          </View>
        )}
      </ScrollView>

      <BottomSheet visible={sheet} onClose={() => setSheet(false)}>
        <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink }}>I'll go if...</Text>
        <Text style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted, marginTop: 2, marginBottom: 10 }}>...these people are going</Text>
        <Toggle options={["At least one", "All of them"]} value={mode} onChange={setMode} />
        <View style={{ marginTop: 12, marginBottom: 4 }}>
          {data.members.map((m: Member) => {
            const on = picked.includes(m.id);
            return (
              <Pressable
                key={m.id}
                onPress={() => setPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 }}
              >
                <Avatar initial={m.name.charAt(0).toUpperCase()} color={ui.muted} size={26} />
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{m.name}</Text>
                <View style={{ marginLeft: "auto" }}>
                  <SelectCheck selected={on} />
                </View>
              </Pressable>
            );
          })}
          {data.members.length === 0 && <Text style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted }}>No one else in this group.</Text>}
        </View>
        <Button
          label="Confirm"
          variant="primary"
          disabled={!picked.length || busy}
          onPress={() => {
            setSheet(false);
            answer("conditional", { mode: mode === "All of them" ? "all" : "any", targetIds: picked });
          }}
          style={{ marginTop: 12 }}
        />
      </BottomSheet>
    </ScreenBackground>
  );
}
```

- [ ] **Step 2: Typecheck + manual + commit**

Run: `pnpm --filter @bethere/mobile typecheck` (Expected: PASS)
Manually verify: respond buttons (green "I'm in", outline "I'll go if..." opens the sheet, outline "Can't make it"); the sheet toggle + member picker + Confirm records a conditional; after responding, the who's-going list shows. Compare to mockup screens 2 and 3.
```bash
git add apps/mobile/src/screens/EventDetail.tsx
git commit -m "feat(mobile): restyle EventDetail + conditional sheet (DRP-25)"
```

### Task 13: CreateEvent

**Files:** Modify `apps/mobile/src/screens/CreateEvent.tsx`

- [ ] **Step 1: Rewrite the render** (keep all existing state + `create()` + `useEffect` data load; replace the returned JSX and remove the old `StyleSheet`)

Replace the entire contents of `apps/mobile/src/screens/CreateEvent.tsx` with:
```tsx
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { BackBar, Button, Card, Chip, Field, ScreenBackground } from "../ui";

type Group = Awaited<ReturnType<typeof trpc.groups.mine.query>>[number];
type Props = NativeStackScreenProps<MeetupsStackParams, "CreateEvent">;

export function CreateEvent({ navigation }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    trpc.groups.mine
      .query()
      .then((mine) => {
        setGroups(mine);
        if (mine[0]) setGroupId(mine[0].id);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const startsAt = date && time ? new Date(`${date}T${time}:00`) : null;
  const validWhen = startsAt !== null && !Number.isNaN(startsAt.getTime());
  const ready = !!groupId && title.trim() !== "" && location.trim() !== "" && validWhen;

  async function create() {
    if (!ready || !groupId || !startsAt || busy) return;
    setBusy(true);
    try {
      await trpc.events.create.mutate({
        groupId,
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim(),
        startsAt: startsAt.toISOString(),
        respondByAt: startsAt.toISOString(),
      });
      navigation.goBack();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <ScreenBackground>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={ui.ink} />
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <BackBar title="Suggest a meet" onBack={() => navigation.goBack()} />
        {error && <Text style={{ fontFamily: font.medium, color: ui.brand, marginBottom: 10 }}>Something went wrong. Try again.</Text>}

        <Text style={{ fontFamily: font.bold, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: ui.ink, marginBottom: 6 }}>Group</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 6 }}>
          {groups.map((g) => (
            <Chip key={g.id} label={g.name} selected={groupId === g.id} onPress={() => setGroupId(g.id)} />
          ))}
        </View>

        <Field label="Title" value={title} onChangeText={setTitle} placeholder="Bowling" style={{ marginTop: 8 }} />
        <Field label="Location" value={location} onChangeText={setLocation} placeholder="TenPin Bexleyheath" style={{ marginTop: 12 }} />
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <Field label="Date" value={date} onChangeText={setDate} placeholder="2026-06-05" style={{ flex: 1 }} />
          <Field label="Time" value={time} onChangeText={setTime} placeholder="16:00" style={{ flex: 1 }} />
        </View>

        <Button label="Create" variant="primary" disabled={!ready || busy} onPress={create} style={{ marginTop: 22 }} />
      </ScrollView>
    </ScreenBackground>
  );
}
```
Note: the description field is intentionally dropped from the form to match the approved mockup; `create()` still sends `description: undefined`. If you want it back, add `<Field label="Description" value={description} onChangeText={setDescription} multiline />` and it will flow through unchanged.

- [ ] **Step 2: Typecheck + manual + commit**

Run: `pnpm --filter @bethere/mobile typecheck` (Expected: PASS)
Manually verify: group chips select; fields accept input; Create is disabled until valid and creates the event. Compare to mockup screen 4.
```bash
git add apps/mobile/src/screens/CreateEvent.tsx
git commit -m "feat(mobile): restyle CreateEvent form (DRP-25)"
```

### Task 14: GroupsList

**Files:** Modify `apps/mobile/src/screens/GroupsList.tsx`

- [ ] **Step 1: Rewrite the render** (keep the existing query + state; replace JSX and styles)

Replace the entire contents of `apps/mobile/src/screens/GroupsList.tsx` with:
```tsx
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { GroupsStackParams } from "../../App";
import { colorFor, initials } from "../lib/format";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { Avatar, Button, Card, Heading, ScreenBackground } from "../ui";

type Group = Awaited<ReturnType<typeof trpc.groups.mine.query>>[number];
type Props = NativeStackScreenProps<GroupsStackParams, "GroupsList">;

export function GroupsList({ navigation }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      trpc.groups.mine
        .query()
        .then((g) => active && setGroups(g))
        .catch(() => active && setError(true))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, []),
  );

  if (loading) {
    return (
      <ScreenBackground>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={ui.ink} />
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <Heading overline={`${groups.length} groups`} title="Your groups" right={<Avatar initial="A" color={ui.muted} size={28} />} />
        {error && <Text style={{ fontFamily: font.medium, color: ui.muted, marginBottom: 12 }}>Couldn't reach the server.</Text>}

        {groups.map((g) => (
          <Pressable key={g.id} onPress={() => navigation.navigate("GroupDetail", { groupId: g.id })}>
            <Card style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
                <Avatar initial={initials(g.name)} color={colorFor(g.id)} />
                <View>
                  <Text style={{ fontFamily: font.display, fontSize: 15, color: ui.ink }}>{g.name}</Text>
                  <Text style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted, marginTop: 1 }}>{g.memberCount} members</Text>
                </View>
                <Text style={{ marginLeft: "auto", fontFamily: font.display, fontSize: 18, color: ui.ink }}>{"›"}</Text>
              </View>
            </Card>
          </Pressable>
        ))}
        {groups.length === 0 && <Text style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted, textAlign: "center", marginTop: 16 }}>No groups yet.</Text>}

        <Button label="New group" variant="primary" onPress={() => navigation.navigate("CreateGroup")} style={{ marginTop: 8 }} />
      </ScrollView>
    </ScreenBackground>
  );
}
```

- [ ] **Step 2: Typecheck + manual + commit**

Run: `pnpm --filter @bethere/mobile typecheck` (Expected: PASS)
Manually verify: group cards show avatar + name + member count + caret and open the detail; New group opens Create. Compare to mockup screen 5.
```bash
git add apps/mobile/src/screens/GroupsList.tsx
git commit -m "feat(mobile): restyle GroupsList (DRP-25)"
```

### Task 15: GroupDetail

**Files:** Modify `apps/mobile/src/screens/GroupDetail.tsx`

- [ ] **Step 1: Rewrite the render** (keep all existing state, `load`, `run`, `openAdd`, and the add-members modal logic; restyle output, and move the add-members modal into `BottomSheet`)

Replace the entire contents of `apps/mobile/src/screens/GroupDetail.tsx` with:
```tsx
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { GroupsStackParams } from "../../App";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { Avatar, BackBar, BottomSheet, Button, Card, Field, ScreenBackground } from "../ui";

type Detail = NonNullable<Awaited<ReturnType<typeof trpc.groups.get.query>>>;
type Addable = Awaited<ReturnType<typeof trpc.groups.addableUsers.query>>;
type Props = NativeStackScreenProps<GroupsStackParams, "GroupDetail">;

export function GroupDetail({ route, navigation }: Props) {
  const { groupId } = route.params;
  const [data, setData] = useState<Detail | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addable, setAddable] = useState<Addable>([]);

  const load = useCallback(() => {
    return trpc.groups.get
      .query({ id: groupId })
      .then((d) => {
        setData(d);
        if (d) setNameDraft(d.name);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function openAdd() {
    try {
      setAddable(await trpc.groups.addableUsers.query({ groupId }));
      setAddOpen(true);
    } catch {
      setError(true);
    }
  }

  if (loading) {
    return (
      <ScreenBackground>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={ui.ink} />
        </View>
      </ScreenBackground>
    );
  }
  if (error || !data) {
    return (
      <ScreenBackground>
        <View style={{ padding: 16 }}>
          <BackBar title="Back" onBack={() => navigation.goBack()} />
          <Text style={{ fontFamily: font.medium, color: ui.muted }}>{error ? "Couldn't reach the server." : "Group not found."}</Text>
        </View>
      </ScreenBackground>
    );
  }

  const renamed = nameDraft.trim() !== "" && nameDraft.trim() !== data.name;

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <BackBar title={data.name} onBack={() => navigation.goBack()} />

        <Field
          label="Group name"
          value={nameDraft}
          onChangeText={setNameDraft}
          right={
            renamed ? (
              <Pressable disabled={busy} onPress={() => run(() => trpc.groups.rename.mutate({ id: groupId, name: nameDraft.trim() }))}>
                <Text style={{ fontFamily: font.bold, fontSize: 12, color: ui.brand }}>Save</Text>
              </Pressable>
            ) : undefined
          }
        />

        <Text style={{ fontFamily: font.bold, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: ui.ink, marginTop: 16, marginBottom: 6 }}>
          Members ({data.members.length})
        </Text>
        <Card padding={0}>
          {data.members.map((m, i) => (
            <View key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: ui.hairline }}>
              <Avatar initial={m.name.charAt(0).toUpperCase()} color={m.color} size={28} />
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{m.name}</Text>
              <Pressable hitSlop={10} disabled={busy} onPress={() => run(() => trpc.groups.removeMember.mutate({ groupId, userId: m.id }))} style={{ marginLeft: "auto" }}>
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.muted }}>{"×"}</Text>
              </Pressable>
            </View>
          ))}
        </Card>

        <Button label="+ Add to group" variant="outline" onPress={openAdd} style={{ marginTop: 16 }} />
      </ScrollView>

      <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)}>
        <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink, marginBottom: 10 }}>Add to group</Text>
        <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
          {addable.map((u) => (
            <Pressable
              key={u.id}
              disabled={busy}
              onPress={async () => {
                await run(() => trpc.groups.addMember.mutate({ groupId, userId: u.id }));
                setAddable((prev) => prev.filter((x) => x.id !== u.id));
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 }}
            >
              <Avatar initial={u.name.charAt(0).toUpperCase()} color={u.color} size={26} />
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{u.name}</Text>
              <Text style={{ marginLeft: "auto", fontFamily: font.display, fontSize: 16, color: ui.brand }}>+</Text>
            </Pressable>
          ))}
          {addable.length === 0 && <Text style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted }}>Everyone's already in.</Text>}
        </ScrollView>
      </BottomSheet>
    </ScreenBackground>
  );
}
```

- [ ] **Step 2: Typecheck + manual + commit**

Run: `pnpm --filter @bethere/mobile typecheck` (Expected: PASS)
Manually verify: rename shows Save and persists; remove (x) works; Add to group opens the sheet and adds. Compare to mockup screen 6.
```bash
git add apps/mobile/src/screens/GroupDetail.tsx
git commit -m "feat(mobile): restyle GroupDetail + add-members sheet (DRP-25)"
```

### Task 16: CreateGroup

**Files:** Modify `apps/mobile/src/screens/CreateGroup.tsx`

- [ ] **Step 1: Rewrite** (keep state + `create()`; restyle)

Replace the entire contents of `apps/mobile/src/screens/CreateGroup.tsx` with:
```tsx
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import type { GroupsStackParams } from "../../App";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { BackBar, Button, Field, ScreenBackground } from "../ui";

type Props = NativeStackScreenProps<GroupsStackParams, "CreateGroup">;

export function CreateGroup({ navigation }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function create() {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    try {
      await trpc.groups.create.mutate({ name: name.trim() });
      navigation.goBack();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <BackBar title="New group" onBack={() => navigation.goBack()} />
        {error && <Text style={{ fontFamily: font.medium, color: ui.brand, marginBottom: 10 }}>Something went wrong. Try again.</Text>}
        <Field label="Group name" value={name} onChangeText={setName} placeholder="The Boys" />
        <Text style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted, marginTop: 8 }}>You can add members once it's created.</Text>
        <Button label="Create group" variant="primary" disabled={name.trim() === "" || busy} onPress={create} style={{ marginTop: 20 }} />
      </ScrollView>
    </ScreenBackground>
  );
}
```

- [ ] **Step 2: Typecheck + manual + commit**

Run: `pnpm --filter @bethere/mobile typecheck` (Expected: PASS)
Manually verify: typing a name enables Create; it creates the group and returns. Compare to mockup screen 7.
```bash
git add apps/mobile/src/screens/CreateGroup.tsx
git commit -m "feat(mobile): restyle CreateGroup (DRP-25)"
```

---

## Phase 4 - Cleanup and verification

### Task 17: Remove legacy theme tokens

**Files:** Modify `apps/mobile/src/theme.ts` (and `App.tsx` if it still imports `colors`)

- [ ] **Step 1: Confirm nothing imports the legacy tokens**

Run:
```bash
grep -rn "colors\|status\|radius" apps/mobile/src apps/mobile/App.tsx | grep -v "src/ui" | grep -v "src/theme.ts"
```
Expected: no references to the legacy `colors`/`status`/`radius` objects remain (only `ui`/`font`). If any screen still uses them, migrate it before deleting. `space` may still be referenced; keep it if so.

- [ ] **Step 2: Delete the unused legacy exports**

In `apps/mobile/src/theme.ts`, remove the `colors`, `status`, and `radius` exports that are no longer referenced (keep `ui`, `font`, and `space` if `space` is still used). Update the file's top comment to describe the new system.

- [ ] **Step 3: Typecheck + lint + commit**

Run: `pnpm --filter @bethere/mobile typecheck && pnpm lint`
Expected: PASS (lint flags unused exports/imports if any remain; fix them).
```bash
git add apps/mobile/src/theme.ts apps/mobile/App.tsx
git commit -m "chore(mobile): drop legacy Sage theme tokens (DRP-25)"
```

### Task 18: Full quality gate + end-to-end click-through

- [ ] **Step 1: Run the whole gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all PASS (vitest for shared incl. the new reveal tests; node:test for api; jest-expo trivial test; biome clean). Fix anything red and re-run.

- [ ] **Step 2: Manual end-to-end on device**

Run: `pnpm dev:api` (in one shell) and `pnpm dev:mobile` (in another); open in Expo Go. Click the full loop: Home -> featured meet -> RSVP (in / I'll go if... / can't) -> back; create a meet; Groups -> group -> add/remove member -> rename; create a group. Confirm no dead-ends, the gradient + boxy cards + stickers render on every screen, and "+N going" appears only on meets whose respond-by time has passed. Compare each screen to `docs/mockups/m3-ux-overhaul/all-screens.html`.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(mobile): UX overhaul polish from end-to-end pass (DRP-25)"
```

### Task 19: Close out Linear

- [ ] **Step 1:** Comment on DRP-25 summarising what shipped (screens restyled, primitives added, the reveal-after-timer rule) and referencing the commits.
- [ ] **Step 2:** Move DRP-25 to **Done**.
- [ ] **Step 3 (optional):** Open a PR `dev` -> `main` only when the team wants to ship; CI runs on that PR. Do not push to `main` directly.

---

## Self-Review (completed during planning)

- **Spec coverage:** tokens (Task 2), fonts (Tasks 1, 3), gradient bg (Task 6), hard shadow (Task 6), all components in spec section 4 (Tasks 6-9), all seven screens + the sheet (Tasks 11-16), nav decision = bottom tabs (Task 10), reveal-after-timer (Tasks 4-5, consumed in Task 11), cleanup of legacy tokens (Task 17). Covered.
- **Placeholder scan:** no TBD/TODO; every code step has complete code; every run step has an expected result.
- **Type consistency:** primitive prop names are used identically across screens (`Button` label/variant/disabled/onPress; `Field` label/value/onChangeText/right; `Tabs`/`Toggle` options/value/onChange; `Avatar` initial/color/size; `Card` padding/radius/style; `DateChip` small; `StatusCheck` status; `SelectCheck` selected). `events.mine` adds `goingCount: number | null` and `goingPreview: {color,initial}[]`, consumed exactly that way in Dashboard. The conditional sheet maps the UI labels ("At least one"/"All of them") to the API `cond.mode` ("any"/"all") in `answer(...)`.
- **Open risks called out:** RN hard-shadow technique (Task 6) and Field/`right` slot are the only non-obvious pieces; both have full code. Description field intentionally dropped from CreateEvent (noted, reversible).

---

## Execution addendum (2026-06-01)

A Clerk auth + web feature landed on `dev` after this plan was written, so several tasks were adapted during execution (all on `feat/drp-25-ux-overhaul`):
- **Task 10 reworked:** `App.tsx` keeps `ClerkProvider > DevAuthProvider > SafeAreaProvider > Shell > Gate`; native headers are hidden; the bottom tabs became THREE - Meetups / Groups / **Account**. A new `Account` screen (`apps/mobile/src/screens/Account.tsx`) holds sign-out for both Clerk and dev users, and the orphaned `AccountButton` was deleted.
- **Added screens/components:** restyled `SignIn`; an `AccountAvatar` component (`apps/mobile/src/components/AccountAvatar.tsx`) for the Home/Groups header initial.
- **Home:** the `Declined` filter tab was added, so the filter is All / Going / Awaiting / Declined (per the spec).
- **API:** `events.mine.goingPreview` items include `uid` (used as a stable React key).
- **ScreenBackground** applies only the top safe-area inset (the bottom tab bar owns the bottom).

All gates green at completion: `pnpm lint`, `pnpm typecheck`, `pnpm test` (23 tests).
