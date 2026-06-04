import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { ui } from "../theme";

// A full-bleed, ink-ruled banner (the loud pink countdown strip). Bleeds past the screen gutter and
// draws top + bottom ink rules so it reads as a distinct band, not a rounded card. Shared by the
// detail countdown banner; the dashboard action panel uses the same brand+ink language as a card.
export function Band({
  children,
  tone = ui.brand,
  style,
}: {
  children: ReactNode;
  tone?: string;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          marginHorizontal: -ui.gutter,
          backgroundColor: tone,
          borderColor: ui.ink,
          borderTopWidth: ui.border,
          borderBottomWidth: ui.border,
          paddingHorizontal: ui.gutter,
          paddingVertical: 14,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
