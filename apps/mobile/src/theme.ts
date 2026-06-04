// Refined-neobrutalist design system (DRP-25). All screens use `ui` and `font`.
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
  rSmall: 6,
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
