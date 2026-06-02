import { Pressable, Text, View } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

// A chip on a float board: a label with a visible +1 count. Tapping toggles your own +1 (filled =
// you're in on it). Counts are public momentum; names are never shown. One tap, optimistic.
export function FloatChip({
  label,
  count,
  mine,
  onPress,
}: {
  label: string;
  count: number;
  mine: boolean;
  onPress: () => void;
}) {
  return (
    <HardShadow radius={ui.rInput} offset={3} style={{ marginRight: 8, marginBottom: 8 }}>
      <Pressable
        onPress={onPress}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: mine ? ui.ink : ui.surface,
          borderWidth: ui.border,
          borderColor: ui.ink,
          borderRadius: ui.rInput,
          paddingVertical: 7,
          paddingLeft: 13,
          paddingRight: 8,
        }}
      >
        <Text style={{ fontFamily: font.bold, fontSize: 13, color: mine ? "#fff" : ui.ink }}>
          {label}
        </Text>
        <View
          style={{
            minWidth: 20,
            paddingHorizontal: 5,
            height: 19,
            borderRadius: 999,
            backgroundColor: mine ? "#fff" : ui.ink,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: font.mono, fontSize: 10, color: mine ? ui.ink : "#fff" }}>
            {count}
          </Text>
        </View>
      </Pressable>
    </HardShadow>
  );
}
