import { Pressable, Text, View } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

// One segmented control. `tabs` is a loose row of bordered pills (the dashboard filter): the active
// pill fills with `activeColor(opt)` and pops with a hard shadow, so each segment has a visible
// boundary and its own colour. `bar` is a connected, full-width bordered track (the old Toggle).
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  variant = "tabs",
  activeColor,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  variant?: "tabs" | "bar";
  activeColor?: (opt: T) => string;
  label?: (opt: T) => string;
}) {
  if (variant === "bar") {
    return (
      <View
        style={{
          flexDirection: "row",
          borderWidth: ui.border,
          borderColor: ui.ink,
          borderRadius: ui.rInput,
          overflow: "hidden",
        }}
      >
        {options.map((opt, i) => {
          const on = opt === value;
          const c = activeColor?.(opt) ?? ui.ink;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 8,
                backgroundColor: on ? c : ui.surface,
                borderLeftWidth: i === 0 ? 0 : ui.border,
                borderLeftColor: ui.ink,
              }}
            >
              <Text
                style={{ fontFamily: font.bold, fontSize: 11, color: on ? ui.onInk : ui.muted }}
              >
                {label?.(opt) ?? opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
      {options.map((opt) => {
        const on = opt === value;
        const c = activeColor?.(opt) ?? ui.ink;
        const pill = (
          <Pressable
            onPress={() => onChange(opt)}
            style={{
              backgroundColor: on ? c : ui.surface,
              borderWidth: ui.border,
              borderColor: ui.ink,
              borderRadius: ui.rPill,
              paddingVertical: 6,
              paddingHorizontal: 15,
            }}
          >
            <Text style={{ fontFamily: font.bold, fontSize: 12, color: on ? ui.onInk : ui.muted }}>
              {label?.(opt) ?? opt}
            </Text>
          </Pressable>
        );
        return (
          <View key={opt}>
            {on ? (
              <HardShadow radius={ui.rPill} offset={ui.shadowInput}>
                {pill}
              </HardShadow>
            ) : (
              pill
            )}
          </View>
        );
      })}
    </View>
  );
}
