import type { ViewStyle } from "react-native";

// Mirrors the union the native picker accepts (@react-native-community/datetimepicker).
export type MinuteInterval = 1 | 2 | 3 | 4 | 5 | 6 | 10 | 12 | 15 | 20 | 30;

// Shared prop shape for the native (DateTimeField.tsx) and web (DateTimeField.web.tsx)
// implementations. `value` stays a plain string so it drops straight into the existing
// `date` / `time` state and `isoFrom` helper in CreateEvent - "YYYY-MM-DD" for date mode,
// "HH:mm" (24h) for time mode, "" when nothing is picked yet.
export type DateTimeFieldProps = {
  label?: string;
  mode: "date" | "time";
  value: string;
  onChange: (next: string) => void;
  minuteInterval?: MinuteInterval; // time mode only
  minimumDate?: Date; // date mode only
  style?: ViewStyle;
};
