import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { ui } from "../theme";
import { HardShadow } from "./HardShadow";
import { AppText } from "./Text";

// The back-button / small-icon chrome square (px).
const BACK_BTN = 32;

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
        <HardShadow radius={ui.rIcon} offset={ui.shadowInput}>
          <Pressable
            onPress={onBack}
            style={{
              width: BACK_BTN,
              height: BACK_BTN,
              borderRadius: ui.rIcon,
              borderWidth: ui.border,
              borderColor: ui.ink,
              backgroundColor: ui.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AppText variant="title" style={{ marginTop: -2 }}>
              {"‹"}
            </AppText>
          </Pressable>
        </HardShadow>
      ) : null}
      <AppText
        variant={onBack ? "title" : "screenTitle"}
        numberOfLines={1}
        style={[{ flexShrink: 1 }, onBack ? { fontSize: 15 } : null]}
      >
        {title}
      </AppText>
      {right ? <View style={{ marginLeft: "auto", paddingLeft: 10 }}>{right}</View> : null}
    </View>
  );
}
