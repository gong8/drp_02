import { View, type ViewStyle } from "react-native";
import { ui } from "../theme";
import { DateTimeField } from "./DateTimeField";
import { DEFAULT_MINUTE_INTERVAL, type MinuteInterval } from "./DateTimeField.types";
import { HardShadow } from "./HardShadow";

// One date + time as a single split pill: a single bordered, hard-shadow box divided by an ink
// hairline into [ date | time ], each half a bare DateTimeField that opens its own native picker.
// Replaces the old "card wrapping two boxes + a TIME label" so the whole app reads cleaner.
export function DateTimePill({
  dateValue,
  timeValue,
  onDate,
  onTime,
  minimumDate,
  maximumDate,
  minuteInterval = DEFAULT_MINUTE_INTERVAL,
  style,
}: {
  dateValue: string;
  timeValue: string;
  onDate: (next: string) => void;
  onTime: (next: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  minuteInterval?: MinuteInterval;
  style?: ViewStyle;
}) {
  return (
    <HardShadow radius={ui.rInput} offset={ui.shadowInput} style={style}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "stretch",
          backgroundColor: ui.surface,
          borderWidth: ui.border,
          borderColor: ui.ink,
          borderRadius: ui.rInput,
          overflow: "hidden",
        }}
      >
        <DateTimeField
          bare
          mode="date"
          value={dateValue}
          onChange={onDate}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          style={{ flex: 1 }}
        />
        <View style={{ width: ui.border, backgroundColor: ui.ink }} />
        <DateTimeField
          bare
          mode="time"
          value={timeValue}
          onChange={onTime}
          minuteInterval={minuteInterval}
          style={{ flex: 1 }}
        />
      </View>
    </HardShadow>
  );
}
