import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ui } from "../theme";

// Full-screen peach-to-lavender gradient behind every screen, with safe-area top padding plus a
// comfortable gap so headers and the back button never sit flush against the status bar / notch.
export function ScreenBackground({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={ui.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}
    >
      <View style={{ flex: 1, paddingTop: insets.top + 14 }}>{children}</View>
    </LinearGradient>
  );
}
