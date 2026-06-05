import { Pressable, Text, type TextStyle } from "react-native";
import { font, ui } from "../theme";

// A bare inline text action (Add / Save / Edit / Cancel). One place for the bold-13 + brand/muted
// colour rule and the hit slop, replacing the hand-rolled `<Pressable><Text>` affordances.
export function TextButton({
  label,
  onPress,
  disabled = false,
  tone = "brand",
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "brand" | "muted";
  style?: TextStyle;
}) {
  const color = disabled ? ui.muted : tone === "muted" ? ui.muted : ui.brand;
  return (
    <Pressable onPress={onPress} hitSlop={8} disabled={disabled}>
      <Text style={[{ fontFamily: font.bold, fontSize: 13, color }, style]}>{label}</Text>
    </Pressable>
  );
}
