import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

// The one header for every screen. With `onBack` it is a detail bar: a back chevron + a compact title
// (e.g. the meetup name). Without it, the title is the big screen heading. `right` is an optional
// trailing slot (the account avatar on the list screens). Replaces Heading + BackBar.
export function ScreenHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginTop: onBack ? 0 : 3,
        marginBottom: onBack ? 12 : 13,
      }}
    >
      {onBack ? (
        <HardShadow radius={9} offset={ui.shadowInput}>
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
      ) : null}
      <Text
        numberOfLines={1}
        style={
          onBack
            ? { flexShrink: 1, fontFamily: font.display, fontSize: 15, color: ui.ink }
            : {
                flexShrink: 1,
                fontFamily: font.black,
                fontSize: 27,
                letterSpacing: -1,
                color: ui.ink,
              }
        }
      >
        {title}
      </Text>
      {right ? <View style={{ marginLeft: "auto", paddingLeft: 10 }}>{right}</View> : null}
    </View>
  );
}
