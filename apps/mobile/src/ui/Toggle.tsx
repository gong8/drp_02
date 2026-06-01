import { Pressable, Text, View } from "react-native";
import { font, ui } from "../theme";

export function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly [T, T];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: "row", borderWidth: ui.border, borderColor: ui.ink, borderRadius: ui.rInput, overflow: "hidden" }}>
      {options.map((opt) => {
        const on = opt === value;
        return (
          <Pressable key={opt} onPress={() => onChange(opt)} style={{ flex: 1, alignItems: "center", paddingVertical: 8, backgroundColor: on ? ui.ink : ui.surface }}>
            <Text style={{ fontFamily: font.bold, fontSize: 11, color: on ? "#fff" : ui.muted }}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
