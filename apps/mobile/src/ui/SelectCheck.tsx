import { Text, View } from "react-native";
import { ui } from "../theme";

// Selection check used in the "I'll go if..." member picker and the opt-out row. `accent` is the
// border + fill colour when selected (pink by default; ink for the opt-out checkbox); unselected
// always reads as an ink outline.
export function SelectCheck({
  selected,
  accent = ui.brand,
}: {
  selected: boolean;
  accent?: string;
}) {
  return (
    <View
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        borderWidth: 1.5,
        borderColor: selected ? accent : ui.ink,
        backgroundColor: selected ? accent : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {selected && <Text style={{ fontSize: 11, color: "#fff" }}>{"✓"}</Text>}
    </View>
  );
}
