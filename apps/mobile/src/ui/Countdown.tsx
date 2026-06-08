import { Text, View } from "react-native";
import { countdownLabel, HOT_MS } from "../lib/format";
import { font, ui } from "../theme";
import { FieldLabel } from "./FieldLabel";

// The one time-left display. Leads with the DURATION (big, tabular) so "how long is left" is the
// obvious thing, with a small uppercase label above it ("RSVP CLOSES"). `color` overrides the text
// colour for loud (on-ink) contexts; otherwise it turns brand under an hour. Owns the "Closing now"
// terminal string so no caller re-strings it.
export function Countdown({
  ms,
  label,
  color,
  big = false,
}: {
  ms: number;
  label?: string;
  color?: string;
  big?: boolean;
}) {
  const hot = ms < HOT_MS;
  const duration = countdownLabel(ms);
  const c = color ?? (hot ? ui.brand : ui.ink);
  return (
    <View>
      {label ? (
        <FieldLabel style={{ color: c, opacity: 0.8, marginBottom: 1 }}>{label}</FieldLabel>
      ) : null}
      <Text
        style={{
          fontFamily: font.black,
          fontSize: big ? 26 : 17,
          letterSpacing: -0.5,
          color: c,
          fontVariant: ["tabular-nums"],
        }}
      >
        {duration}
      </Text>
    </View>
  );
}
