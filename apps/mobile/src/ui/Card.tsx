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
          // Clip full-bleed rows (e.g. the tinted opt-out row) to the rounded corners so their
          // square edges never poke past the card.
          overflow: "hidden",
          padding,
        }}
      >
        {children}
      </View>
    </HardShadow>
  );
}
