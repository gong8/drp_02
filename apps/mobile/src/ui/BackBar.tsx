import { Pressable, Text, View } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

export function BackBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <HardShadow radius={9} offset={3}>
        <Pressable
          onPress={onBack}
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            borderWidth: ui.border,
            borderColor: ui.ink,
            backgroundColor: ui.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink, marginTop: -2 }}>
            {"‹"}
          </Text>
        </Pressable>
      </HardShadow>
      <Text style={{ fontFamily: font.display, fontSize: 15, color: ui.ink }}>{title}</Text>
    </View>
  );
}
