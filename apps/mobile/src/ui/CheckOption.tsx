import type { ViewStyle } from "react-native";
import { Pressable, View } from "react-native";
import { ui } from "../theme";
import { SelectCheck } from "./SelectCheck";
import { AppText } from "./Text";

// A label (+ optional sub) with a checkbox - the single "tick this option" row. Plain by default (the
// wizard lock toggles); `tinted` gives it the bordered lavender treatment (the opt-out row). Always
// uses SelectCheck, so there is one checkbox glyph in the app.
export function CheckOption({
  label,
  sub,
  on,
  onToggle,
  accent = ui.ink,
  tinted = false,
  disabled = false,
  style,
}: {
  label: string;
  sub?: string;
  on: boolean;
  onToggle: () => void;
  accent?: string;
  tinted?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const tintBox: ViewStyle = tinted
    ? {
        padding: 12,
        borderRadius: ui.rInput,
        backgroundColor: ui.tint,
        borderWidth: ui.border,
        borderColor: ui.ink,
      }
    : {};
  return (
    <Pressable
      onPress={disabled ? undefined : onToggle}
      style={[
        { flexDirection: "row", alignItems: "center", gap: 12, opacity: disabled ? 0.4 : 1 },
        tintBox,
        style,
      ]}
    >
      <SelectCheck selected={on} accent={accent} size={22} />
      <View style={{ flex: 1 }}>
        <AppText variant="rowLabelSm">{label}</AppText>
        {sub ? (
          <AppText variant="caption" style={{ marginTop: 1 }}>
            {sub}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}
