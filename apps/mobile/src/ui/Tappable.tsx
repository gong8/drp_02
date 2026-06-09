import type { ReactNode } from "react";
import { Pressable, type StyleProp, View, type ViewStyle } from "react-native";

// Renders a Pressable when `onPress` is set, otherwise a plain View - the "optionally tappable
// surface" idiom shared by Card, Row, and PersonRow.
export function Tappable({
  onPress,
  style,
  disabled,
  children,
}: {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  children: ReactNode;
}) {
  return onPress ? (
    <Pressable onPress={onPress} disabled={disabled} style={style}>
      {children}
    </Pressable>
  ) : (
    <View style={style}>{children}</View>
  );
}
