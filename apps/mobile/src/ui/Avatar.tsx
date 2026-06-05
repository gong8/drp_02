import { Text, View } from "react-native";
import { font, ui } from "../theme";

export function Avatar({
  initial,
  color,
  size = 32,
}: {
  initial: string;
  color: string;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: ui.border,
        borderColor: ui.ink,
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: font.display, fontSize: size * 0.38, color: ui.onInk }}>
        {initial}
      </Text>
    </View>
  );
}
