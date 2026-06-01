import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { font, ui } from "../theme";

export function Heading({ overline, title, right }: { overline?: string; title: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 13 }}>
      <View style={{ flex: 1 }}>
        {overline ? (
          <Text style={{ fontFamily: font.bold, fontSize: 9, letterSpacing: 1.4, textTransform: "uppercase", color: ui.ink }}>{overline}</Text>
        ) : null}
        <Text style={{ fontFamily: font.black, fontSize: 27, letterSpacing: -1, color: ui.ink, marginTop: 3 }}>{title}</Text>
      </View>
      {right}
    </View>
  );
}
