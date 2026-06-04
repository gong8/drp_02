import { View } from "react-native";
import { ui } from "../theme";

// The draining deadline progress bar (a bordered track with a fill): 1 = just opened, 0 = at the
// deadline. Goes "hot" (brand pink instead of green) under a quarter left, unless `hot` is forced.
const HOT_THRESHOLD = 0.25;

export function DrainBar({ frac, hot }: { frac: number; hot?: boolean }) {
  const isHot = hot ?? frac < HOT_THRESHOLD;
  return (
    <View
      style={{
        height: 12,
        borderWidth: ui.border,
        borderColor: ui.ink,
        borderRadius: 999,
        backgroundColor: ui.surface,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          height: "100%",
          width: `${Math.round(frac * 100)}%`,
          backgroundColor: isHot ? ui.brand : ui.going,
        }}
      />
    </View>
  );
}
