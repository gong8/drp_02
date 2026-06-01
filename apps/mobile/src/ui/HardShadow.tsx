import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { ui } from "../theme";

// RN shadows are blurred and Android elevation cannot offset, so we fake the `4px 4px 0`
// neobrutalist shadow with a solid ink rectangle the same size as the child, shifted by `offset`.
export function HardShadow({
  children,
  radius = ui.rCard,
  offset = ui.shadow,
  color = ui.ink,
  style,
}: {
  children: ReactNode;
  radius?: number;
  offset?: number;
  color?: string;
  style?: ViewStyle;
}) {
  return (
    <View style={style}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: offset,
          left: offset,
          right: -offset,
          bottom: -offset,
          backgroundColor: color,
          borderRadius: radius,
        }}
      />
      {children}
    </View>
  );
}
