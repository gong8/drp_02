import type { ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { ui } from "../theme";
import { HardShadow } from "./HardShadow";

// The bordered, hard-shadow surface. Pass `onPress` to make the whole card tappable (it renders a
// Pressable internally) so call sites stop wrapping `<Pressable><Card>` by hand.
export function Card({
  children,
  padding = 12,
  radius = ui.rCard,
  tone = ui.surface,
  onPress,
  disabled = false,
  style,
}: {
  children: ReactNode;
  padding?: number;
  radius?: number;
  tone?: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const boxStyle: ViewStyle = {
    backgroundColor: tone,
    borderWidth: ui.border,
    borderColor: ui.ink,
    borderRadius: radius,
    // Clip full-bleed rows (e.g. the tinted opt-out row) to the rounded corners so their square edges
    // never poke past the card.
    overflow: "hidden",
    padding,
  };
  return (
    <HardShadow radius={radius} style={style}>
      {onPress ? (
        <Pressable onPress={onPress} disabled={disabled} style={boxStyle}>
          {children}
        </Pressable>
      ) : (
        <View style={boxStyle}>{children}</View>
      )}
    </HardShadow>
  );
}
