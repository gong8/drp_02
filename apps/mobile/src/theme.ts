// Refined-neobrutalist design system (DRP-25). All screens use `ui` and `font`.
export const ui = {
  gradient: ["#FCEFE8", "#ECEAFF"] as [string, string],
  surface: "#FFFFFF",
  ink: "#111111",
  muted: "#7D7A86",
  hairline: "rgba(0,0,0,0.10)",
  scrim: "rgba(24,18,34,0.45)",
  onInk: "#FFFFFF", // text/icon on an ink or brand fill
  tint: "#F1EEF6", // lavender selection tint (your own pick, the opt-out row)
  brand: "#FF5CA8", // pink: urgent / reply / time-pressure + primary
  going: "#34A853", // green: going + affirmative
  open: "#7E6BB0", // purple: open / still being decided
  gutter: 16, // the screen edge gutter (scroll padding, header padding, full-bleed bleed)
  rCard: 18,
  rButton: 14,
  rInput: 12,
  rTab: 8,
  rIcon: 9, // back-button / small-icon chrome radius; couples the header shadow and pressable
  rSmall: 6,
  rPill: 999, // fully rounded (circular chrome, pills)
  border: 2,
  shadow: 4, // hard offset in px (cards, buttons)
  shadowInput: 3, // tighter hard offset for inputs, chips, and small pressables
} as const;

export const font = {
  display: "Archivo_800ExtraBold",
  black: "Archivo_900Black",
  medium: "Inter_500Medium",
  bold: "Inter_700Bold",
} as const;

// The bordered input-surface frame shared by Field, DateTimeField, and DateTimePill. Style-only;
// each site spreads it and layers its own layout (direction/alignment/padding) on top.
export const fieldBox = {
  backgroundColor: ui.surface,
  borderWidth: ui.border,
  borderColor: ui.ink,
  borderRadius: ui.rInput,
} as const;
