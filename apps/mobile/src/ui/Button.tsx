import { Pressable, Text, View, type ViewStyle } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

type Variant = "primary" | "affirmative" | "outline";
type Size = "md" | "lg";

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
  const bg = variant === "primary" ? ui.brand : variant === "affirmative" ? ui.going : ui.surface;
  const fg = variant === "outline" ? ui.ink : "#fff";
  // "lg" is the full-width dashboard CTA; "md" is the default everywhere else.
  const pad = size === "lg" ? 18 : 13;
  const fontSize = size === "lg" ? 17 : 14;
  return (
    <View style={[{ opacity: disabled ? 0.45 : 1 }, style]}>
      <HardShadow radius={ui.rButton}>
        <Pressable
          disabled={disabled}
          onPress={onPress}
          style={{
            backgroundColor: bg,
            borderWidth: ui.border,
            borderColor: ui.ink,
            borderRadius: ui.rButton,
            paddingVertical: pad,
            alignItems: "center",
          }}
        >
          <Text style={{ fontFamily: font.display, fontSize, color: fg }}>{label}</Text>
        </Pressable>
      </HardShadow>
    </View>
  );
}
