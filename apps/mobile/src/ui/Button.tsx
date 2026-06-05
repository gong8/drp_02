import { Pressable, Text, View, type ViewStyle } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

type Variant = "primary" | "affirmative" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg =
    variant === "primary"
      ? ui.brand
      : variant === "affirmative"
        ? ui.going
        : variant === "ghost"
          ? "transparent"
          : ui.surface;
  const fg = variant === "outline" || variant === "ghost" ? ui.ink : ui.onInk;
  // "lg" is the full-width dashboard CTA; "sm" is the compact inline button (Add / Cancel); "md" the
  // default. Ghost has no hard shadow so it reads as the quiet secondary action.
  const padV = size === "lg" ? 18 : size === "sm" ? 9 : 13;
  const padH = size === "sm" ? 16 : undefined;
  const fontSize = size === "lg" ? 17 : size === "sm" ? 13 : 14;
  const pressable = (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: bg,
        borderWidth: ui.border,
        borderColor: ui.ink,
        borderRadius: ui.rButton,
        paddingVertical: padV,
        paddingHorizontal: padH,
        alignItems: "center",
      }}
    >
      <Text style={{ fontFamily: font.display, fontSize, color: fg }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={[{ opacity: disabled ? 0.45 : 1 }, style]}>
      {variant === "ghost" ? pressable : <HardShadow radius={ui.rButton}>{pressable}</HardShadow>}
    </View>
  );
}
