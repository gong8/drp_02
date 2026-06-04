import { Text, View } from "react-native";
import { ui } from "../theme";

// The single check primitive used everywhere a box is ticked (vote rows, the opt-out / lock options,
// the member picker, source cards). `accent` is the border + fill when selected (pink by default, ink
// for neutral checks); `size` scales the box (18 inline, 22 for the larger option rows).
export function SelectCheck({
  selected,
  accent = ui.brand,
  size = 18,
}: {
  selected: boolean;
  accent?: string;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size >= 22 ? 6 : 5,
        borderWidth: 1.5,
        borderColor: selected ? accent : ui.ink,
        backgroundColor: selected ? accent : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {selected && <Text style={{ fontSize: size * 0.6, color: ui.onInk }}>{"✓"}</Text>}
    </View>
  );
}
