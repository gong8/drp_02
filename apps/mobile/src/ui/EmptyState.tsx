import { Text } from "react-native";
import { font, ui } from "../theme";
import { Card } from "./Card";

// The shared empty-list / inline-note line: one centered muted line. `inCard` wraps it in a Card for
// the "nothing here yet" placeholders; bare otherwise. Keeps empty-state copy and style in one place.
export function EmptyState({ children, inCard = false }: { children: string; inCard?: boolean }) {
  const text = (
    <Text
      style={{
        fontFamily: font.medium,
        fontSize: 13,
        color: ui.muted,
        textAlign: "center",
        paddingVertical: inCard ? 10 : 16,
      }}
    >
      {children}
    </Text>
  );
  return inCard ? <Card>{text}</Card> : text;
}
