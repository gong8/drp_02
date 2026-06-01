import type { ReactNode } from "react";
import { Text, TextInput, View, type ViewStyle } from "react-native";
import { font, ui } from "../theme";
import { HardShadow } from "./HardShadow";

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  editable = true,
  right,
  style,
}: {
  label: string;
  value: string;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  editable?: boolean;
  right?: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={style}>
      <Text
        style={{
          fontFamily: font.bold,
          fontSize: 9,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: ui.ink,
          marginBottom: 5,
        }}
      >
        {label}
      </Text>
      <HardShadow radius={ui.rInput} offset={3}>
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
