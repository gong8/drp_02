import type { ReactNode } from "react";
import { StyleSheet, Text, type TextStyle } from "react-native";
import { font, ui } from "../theme";

// The shared uppercase overline used to label form fields (Field, DateTimeField). One typographic
// recipe so the field-label look has a single source of truth; pass `style` to add margins etc.
export function FieldLabel({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[styles.label, style]}>{children}</Text>;
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
