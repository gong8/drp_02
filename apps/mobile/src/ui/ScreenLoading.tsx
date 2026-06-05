import { ActivityIndicator, View } from "react-native";
import { ui } from "../theme";
import { ScreenBackground } from "./ScreenBackground";

// The full-screen loading state shared by every screen: a centered ink spinner over the gradient.
export function ScreenLoading() {
  return (
    <ScreenBackground>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={ui.ink} />
      </View>
    </ScreenBackground>
  );
}
