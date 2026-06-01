import { Pressable, Text, View } from "react-native";
import { font, ui } from "../theme";

export function Tabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 7, marginBottom: 12 }}>
      {options.map((opt) => {
        const on = opt === value;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={{
              backgroundColor: on ? ui.ink : "transparent",
              borderRadius: ui.rTab,
              paddingVertical: 5,
              paddingHorizontal: 11,
            }}
          >
            <Text style={{ fontFamily: font.bold, fontSize: 11, color: on ? "#fff" : ui.muted }}>
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
