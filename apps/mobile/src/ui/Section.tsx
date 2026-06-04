import type { ReactNode } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { font, ui } from "../theme";
import { AppText } from "./Text";

// A display-font heading (+ optional muted sub) over its children, with one spacing rhythm. `sm` is
// the in-card section heading (13); `lg` is the wizard-step / sheet heading (22). Replaces the
// per-screen Section / Step / inline heading copies.
export function Section({
  title,
  sub,
  size = "sm",
  children,
  style,
}: {
  title: string;
  sub?: string;
  size?: "sm" | "lg";
  children?: ReactNode;
  style?: ViewStyle;
}) {
  const lg = size === "lg";
  return (
    <View style={[lg ? null : { marginBottom: 22 }, style]}>
      <Text
        style={{
          fontFamily: font.display,
          fontSize: lg ? 22 : 13,
          letterSpacing: lg ? -0.5 : 0,
          color: ui.ink,
          marginBottom: lg ? 0 : 10,
        }}
      >
        {title}
      </Text>
      {sub ? (
        <AppText
          variant="caption"
          style={{ marginTop: 6, marginBottom: lg ? 14 : 10, lineHeight: 18 }}
        >
          {sub}
        </AppText>
      ) : lg ? (
        <View style={{ height: 14 }} />
      ) : null}
      {children}
    </View>
  );
}
