import { Pressable, Text } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

export function Chip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <HardShadow
      radius={ui.rInput}
      offset={ui.shadowInput}
      style={{ marginRight: 8, marginBottom: 8 }}
    >
      <Pressable
        onPress={onPress}
        style={{
          backgroundColor: selected ? ui.ink : ui.surface,
          borderWidth: ui.border,
          borderColor: ui.ink,
          borderRadius: ui.rInput,
          paddingVertical: 7,
          paddingHorizontal: 13,
        }}
      >
        <Text style={{ fontFamily: font.bold, fontSize: 12, color: selected ? "#fff" : ui.ink }}>
          {label}
        </Text>
      </Pressable>
    </HardShadow>
  );
}
