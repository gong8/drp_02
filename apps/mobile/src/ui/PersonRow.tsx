import type { ReactNode } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { font, ui } from "../theme";
import { Avatar } from "./Avatar";

// A hairline-divided avatar + bold-name list row, shared by the group roster (GroupDetail) and the
// "who's in" reveal (EventDetail). `index` drives the top divider (the first row has none); `right`
// is an optional trailing slot (a remove button, a check, etc). `padding` and `avatarSize` stay
// parameters because the call sites differ on them.
export function PersonRow({
  name,
  color,
  index,
  right,
  padding = 11,
  avatarSize = 26,
  style,
}: {
  name: string;
  color: string;
  index: number;
  right?: ReactNode;
  padding?: number;
  avatarSize?: number;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding,
          borderTopWidth: index === 0 ? 0 : 1,
          borderTopColor: ui.hairline,
        },
        style,
      ]}
    >
      <Avatar initial={name.charAt(0).toUpperCase()} color={color} size={avatarSize} />
      <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{name}</Text>
      {right}
    </View>
  );
}
