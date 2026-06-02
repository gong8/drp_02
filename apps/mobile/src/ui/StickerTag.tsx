import { Text } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

export function StickerTag({ label, color = ui.brand }: { label: string; color?: string }) {
  return (
    <HardShadow radius={ui.rSmall} offset={3} style={{ transform: [{ rotate: "4deg" }] }}>
      <Text
        style={{
          fontFamily: font.mono,
          fontSize: 9,
          color: "#fff",
          backgroundColor: color,
          borderRadius: ui.rSmall,
          paddingHorizontal: 7,
          paddingVertical: 3,
          overflow: "hidden",
        }}
      >
        {label}
      </Text>
    </HardShadow>
  );
}
