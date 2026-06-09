import type { ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { firstInitial } from "../lib/format";
import { ui } from "../theme";
import { Avatar } from "./Avatar";
import { AppText } from "./Text";

// An avatar + bold-name list row, shared by the group roster, the "who's in" reveal, and the two
// member pickers. `index` drives the top divider (the first row has none) when `divided`; pass
// `divided={false}` for the borderless picker rows in sheets. `onPress` makes it tappable; `right` is
// an optional trailing slot (a remove button, a check, a +).
export function PersonRow({
  name,
  color,
  index,
  right,
  rightAlign = true,
  padding = 11,
  avatarSize = 26,
  divided = true,
  onPress,
  style,
}: {
  name: string;
  color: string;
  index: number;
  right?: ReactNode;
  rightAlign?: boolean;
  padding?: number;
  avatarSize?: number;
  divided?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const rowStyle: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding,
    borderTopWidth: divided && index > 0 ? 1 : 0,
    borderTopColor: ui.hairline,
  };
  const inner = (
    <>
      <Avatar initial={firstInitial(name)} color={color} size={avatarSize} />
      <AppText variant="rowLabelSm">{name}</AppText>
      {right != null ? (
        rightAlign ? (
          <View style={{ marginLeft: "auto" }}>{right}</View>
        ) : (
          right
        )
      ) : null}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={[rowStyle, style]}>
      {inner}
    </Pressable>
  ) : (
    <View style={[rowStyle, style]}>{inner}</View>
  );
}
