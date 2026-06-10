import type { ReactNode } from "react";
import { Text, TextInput, View, type ViewStyle } from "react-native";
import { fieldBox, font, ui } from "../theme";
import { FieldLabel } from "./FieldLabel";
import { HardShadow } from "./HardShadow";

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  editable = true,
  optional = false,
  right,
  style,
}: {
  label: string;
  value: string;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  editable?: boolean;
  optional?: boolean;
  right?: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={style}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 5 }}>
        <FieldLabel>{label}</FieldLabel>
        {optional && (
          <Text style={{ fontFamily: font.medium, fontSize: 9, color: ui.muted, marginLeft: 6 }}>
            optional
          </Text>
        )}
      </View>
      <HardShadow radius={ui.rInput} offset={ui.shadowInput}>
        <View
          style={{
            ...fieldBox,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 11,
            gap: 8,
          }}
        >
          <TextInput
            style={{
              flex: 1,
              // Without this a flex input defaults to min-width:auto on web and refuses to shrink
              // below its content, so a long value (e.g. a share link) overflows under `right`.
              minWidth: 0,
              fontFamily: font.medium,
              fontSize: 13,
              color: ui.ink,
              paddingVertical: 10,
              minHeight: multiline ? 64 : undefined,
            }}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={ui.muted}
            multiline={multiline}
            editable={editable}
          />
          {right}
        </View>
      </HardShadow>
    </View>
  );
}
