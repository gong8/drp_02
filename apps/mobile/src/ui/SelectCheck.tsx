import { Text, View } from "react-native";
import { ui } from "../theme";

// Pink selection check used in the "I'll go if..." member picker.
export function SelectCheck({ selected }: { selected: boolean }) {
  return (
    <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: selected ? ui.brand : ui.ink, backgroundColor: selected ? ui.brand : "transparent", alignItems: "center", justifyContent: "center" }}>
      {selected && <Text style={{ fontSize: 11, color: "#fff" }}>{"✓"}</Text>}
    </View>
  );
}
