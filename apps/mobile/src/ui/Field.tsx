import type { ReactNode } from "react";
import { Text, TextInput, View, type ViewStyle } from "react-native";
import { font, ui } from "../theme";
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
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: ui.surface,
            borderWidth: ui.border,
            borderColor: ui.ink,
            borderRadius: ui.rInput,
            paddingHorizontal: 11,
          }}
        >
          <TextInput
            style={{
              flex: 1,
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
