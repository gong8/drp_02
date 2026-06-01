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
          padding,
        }}
      >
        {children}
      </View>
    </HardShadow>
  );
}
