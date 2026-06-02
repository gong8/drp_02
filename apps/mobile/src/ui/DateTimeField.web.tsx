import type { ChangeEvent } from "react";
import { Text, View } from "react-native";
import { font, ui } from "../theme";
import type { DateTimeFieldProps } from "./DateTimeField.types";

// Web fallback. @react-native-community/datetimepicker has no web build, so on web we use the
// browser's built-in <input type="date"> / <input type="time"> controls - real calendar and
// time dropdowns, zero dependencies. Their value format already matches our state exactly
// ("YYYY-MM-DD" for date, "HH:mm" 24h for time), so no conversion is needed. Native (iOS /
// Android) uses DateTimeField.tsx; this file is only ever bundled for web, so the raw DOM
// <input> and the native-only picker never reach the same bundle.

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function DateTimeField({
  label,
  mode,
  value,
  onChange,
  minuteInterval = 15,
  minimumDate,
  bare = false,
  style,
}: DateTimeFieldProps) {
  const isDate = mode === "date";
  const min =
    isDate && minimumDate
      ? `${minimumDate.getFullYear()}-${pad(minimumDate.getMonth() + 1)}-${pad(minimumDate.getDate())}`
      : undefined;

  return (
    <View style={style}>
      {label && !bare ? (
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
      ) : null}
      <input
        type={isDate ? "date" : "time"}
        value={value}
        min={min}
        // <input type="time"> step is in seconds; 15 min = 900s constrains the minute stepper.
        step={isDate ? undefined : minuteInterval * 60}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          backgroundColor: bare ? "transparent" : ui.surface,
          // `bare` drops its own frame so the DateTimePill container provides the single box.
          border: bare ? "none" : `${ui.border}px solid ${ui.ink}`,
          borderRadius: bare ? 0 : ui.rInput,
          padding: bare ? "12px" : "10px 11px",
          fontFamily: font.medium,
          fontSize: 13,
          color: ui.ink,
          boxShadow: bare ? "none" : `3px 3px 0 0 ${ui.ink}`,
          // Tints the calendar/time popup selection in supporting browsers.
          accentColor: ui.brand,
          outline: "none",
        }}
      />
    </View>
  );
}
