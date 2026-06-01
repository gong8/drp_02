import { Pressable, Text, View, type ViewStyle } from "react-native";
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
            paddingVertical: 13,
            alignItems: "center",
          }}
        >
          <Text style={{ fontFamily: font.display, fontSize: 14, color: fg }}>{label}</Text>
        </Pressable>
      </HardShadow>
    </View>
  );
}
