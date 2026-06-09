import { Platform, StyleSheet, Text, View } from "react-native";
import { font } from "../theme";

// Desktop-web only. The app is a centered phone-width column (see App.tsx Shell), which leaves wide
// pink gutters on a big screen. We fill them with a subtle diagonal "BeThere" watermark: an oversized
// rotated field of small, faint, tone-on-tone words. Rotating + over-sizing makes the pattern bleed
// off every edge, so it reads as intentional brand texture instead of chopped-off headlines. It sits
// BEHIND the column (which is opaque), so only the gutters reveal it. pointerEvents is off so it never
// intercepts taps, and it returns null on native (phones have no gutters).

const LINE = "BeThere   ".repeat(20); // one row, long enough to span the oversized field
// Stable keys for the fixed-length, never-reordered set of rows; enough to fill the oversized,
// rotated field (extras clip off-screen). Static ids avoid keying on the array index.
const ROW_KEYS = Array.from({ length: 30 }, (_, r) => `bg-row-${r}`);

export function WebBackdrop() {
  if (Platform.OS !== "web") return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
      <View
        style={{
          position: "absolute",
          top: "-40%",
          left: "-40%",
          width: "180%",
          height: "180%",
          justifyContent: "center",
          transform: [{ rotate: "-18deg" }],
        }}
      >
        {ROW_KEYS.map((rowKey) => (
          <Text
            key={rowKey}
            numberOfLines={1}
            style={{
              fontFamily: font.black,
              fontSize: 30,
              lineHeight: 62,
              letterSpacing: 2,
              color: "rgba(255,255,255,0.11)",
            }}
          >
            {LINE}
          </Text>
        ))}
      </View>
    </View>
  );
}
