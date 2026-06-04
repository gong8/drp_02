import { Text, type TextStyle } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

// One small-label primitive. `outline` is the bordered white data chip (the old DateChip); `solid` is
// the filled, white-text status sticker (the old StickerTag), optionally tilted with a hard shadow.
// `mono` turns on tabular figures for counts/times.
export function Pill({
  label,
  tone = "outline",
  color = ui.brand,
  tilt = false,
  mono = false,
}: {
  label: string;
  tone?: "outline" | "solid";
  color?: string;
  tilt?: boolean;
  mono?: boolean;
}) {
  const base: TextStyle = {
    fontFamily: tone === "solid" ? font.display : font.bold,
    fontSize: tone === "solid" ? 9 : 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: ui.rSmall,
    overflow: "hidden",
    ...(mono ? { fontVariant: ["tabular-nums"] } : {}),
  };
  if (tone === "outline") {
    return (
      <Text
        style={[
          base,
          { color: ui.ink, borderWidth: 1, borderColor: ui.ink, backgroundColor: ui.surface },
        ]}
      >
        {label}
      </Text>
    );
  }
  return (
    <HardShadow
      radius={ui.rSmall}
      offset={ui.shadowInput}
      style={tilt ? { transform: [{ rotate: "4deg" }] } : undefined}
    >
      <Text style={[base, { color: ui.onInk, backgroundColor: color }]}>{label}</Text>
    </HardShadow>
  );
}

// The status badge: a solid tilted pill in the status colour. One place to make a status read loud.
export function StatusPill({ label, color = ui.brand }: { label: string; color?: string }) {
  return <Pill label={label} tone="solid" color={color} tilt />;
}
