import { Text } from "react-native";
import { font, ui } from "../theme";

export function DateChip({ children, small = false }: { children: string; small?: boolean }) {
  return (
    <Text
      style={{
        fontFamily: font.mono,
        fontSize: small ? 9 : 10,
        color: ui.ink,
        borderWidth: 1,
        borderColor: ui.ink,
        borderRadius: ui.rSmall,
        paddingHorizontal: 7,
        paddingVertical: 3,
        overflow: "hidden",
      }}
    >
      {children}
    </Text>
  );
}
