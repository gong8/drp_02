import { Text } from "react-native";
import { font, ui } from "../theme";

export function Heading({ title }: { title: string }) {
  return (
    <Text
      style={{
        fontFamily: font.black,
        fontSize: 27,
        letterSpacing: -1,
        color: ui.ink,
        marginTop: 3,
        marginBottom: 13,
      }}
    >
      {title}
    </Text>
  );
}
