import type { ReactNode } from "react";
import { StyleSheet, Text, type TextStyle } from "react-native";
import { font, ui } from "../theme";

// The shared uppercase overline used to label form fields and small section headings (Field,
// DateTimeField, "Members", "Who's in"). One typographic recipe so the look has a single source of
// truth; `tone` switches ink (default) vs muted; pass `style` to add margins etc.
export function FieldLabel({
  children,
  tone = "ink",
  style,
}: {
  children: ReactNode;
  tone?: "ink" | "muted";
  style?: TextStyle;
}) {
  return (
    <Text style={[styles.label, tone === "muted" && { color: ui.muted }, style]}>{children}</Text>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: font.bold,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: ui.ink,
  },
});
