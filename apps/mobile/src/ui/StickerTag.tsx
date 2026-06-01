import { Text } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

export function StickerTag({ label }: { label: string }) {
  return (
    <HardShadow radius={ui.rSmall} offset={2} style={{ transform: [{ rotate: "4deg" }] }}>
      <Text
        style={{
          fontFamily: font.mono,
          fontSize: 9,
          color: "#fff",
          backgroundColor: ui.brand,
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
