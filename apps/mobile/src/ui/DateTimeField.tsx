import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import {
  dateStringFrom,
  parseLocalDate,
  parseLocalTime,
  shortDayLabel,
  shortTimeLabel,
  timeStringFrom,
} from "../lib/format";
import { fieldBox, font, ui } from "../theme";
import { BottomSheet } from "./BottomSheet";
import { type DateTimeFieldProps, DEFAULT_MINUTE_INTERVAL } from "./DateTimeField.types";
import { HardShadow } from "./HardShadow";

// Themed wrapper around the inbuilt native date/time picker
// (@react-native-community/datetimepicker, bundled in Expo Go). The trigger mirrors the
// `Field` look; tapping opens the native picker - on iOS inside our `BottomSheet`
// (date = inline calendar tinted with brand pink; time = wheel snapped to `minuteInterval`),
// on Android via the imperative dialog. Output strings match `isoFrom` in lib/format.

function roundUpToInterval(d: Date, interval: number): Date {
  const out = new Date(d);
  out.setSeconds(0, 0);
  const rem = out.getMinutes() % interval;
  if (rem !== 0) out.setMinutes(out.getMinutes() + (interval - rem));
  return out;
}

// Clamp a Date into [min, max] on epoch milliseconds (either bound optional). The native picker
// rejects values outside its own minimumDate/maximumDate, but dismissing it without scrolling
// commits the seeded default verbatim - so a "now" seed must be pulled inside the bounds first,
// or it becomes an out-of-range date the server then rejects.
export function clampDate(d: Date, min?: Date, max?: Date): Date {
  let ms = d.getTime();
  if (min) ms = Math.max(ms, min.getTime());
  if (max) ms = Math.min(ms, max.getTime());
  return ms === d.getTime() ? d : new Date(ms);
}

// Seed the picker from the current value, falling back to a sensible "now". Parsing lives in
// lib/format's parseLocalDate/parseLocalTime (the inverse builders, which keep the "never
// new Date(string)" invariant in one place). In date mode the result is clamped to [min, max] so
// the dismiss-commit default always satisfies the picker's own constraints (time mode has no date
// bounds, so they are not applied there).
function seed(
  mode: "date" | "time",
  value: string,
  interval: number,
  min?: Date,
  max?: Date,
): Date {
  const now = new Date();
  if (mode === "date") {
    const d = (value && parseLocalDate(value)) || now;
    return clampDate(d, min, max);
  }
  return (value && parseLocalTime(value)) || roundUpToInterval(now, interval);
}

// Friendly trigger label (e.g. "Fri, 5 Jun" / "4:00 PM"); null when unset. Same parse contract as
// the wheel (via lib/format) so the label matches it exactly.
function displayValue(mode: "date" | "time", value: string): string | null {
  if (!value) return null;
  if (mode === "date") {
    const d = parseLocalDate(value);
    return d ? shortDayLabel(d) : value;
  }
  const t = parseLocalTime(value);
  return t ? shortTimeLabel(t) : value;
}

export function DateTimeField({
  mode,
  value,
  onChange,
  minuteInterval = DEFAULT_MINUTE_INTERVAL,
  minimumDate,
  maximumDate,
  bare = false,
  style,
}: DateTimeFieldProps) {
  const [open, setOpen] = useState(false);
  // Placeholder seed only - always replaced by openPicker's fresh seed before the sheet shows.
  const [temp, setTemp] = useState<Date>(() =>
    seed(mode, value, minuteInterval, minimumDate, maximumDate),
  );

  // Mode-gated native-picker props, derived once (mirrors DateTimeField.web's `isDate`): the minute
  // interval applies to time mode, the date bounds to date mode. Used at both the Android and iOS sites.
  const isDate = mode === "date";
  const gatedMin = isDate ? minimumDate : undefined;
  const gatedMax = isDate ? maximumDate : undefined;
  const gatedInterval = isDate ? undefined : minuteInterval;

  const shown = displayValue(mode, value);
  // Shown only on the empty trigger; the picker sheet itself has no redundant title.
  const placeholder = isDate ? "Pick a date" : "Pick a time";

  function commit(d: Date) {
    onChange(mode === "date" ? dateStringFrom(d) : timeStringFrom(d));
  }

  function openPicker() {
    const initial = seed(mode, value, minuteInterval, minimumDate, maximumDate);
    setTemp(initial);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: initial,
        mode,
        is24Hour: false,
        minuteInterval: gatedInterval,
        minimumDate: gatedMin,
        maximumDate: gatedMax,
        display: isDate ? "calendar" : "clock",
        onChange: (event: DateTimePickerEvent, date?: Date) => {
          if (event.type === "set" && date) commit(date);
        },
      });
      return;
    }
    setOpen(true);
  }

  const trigger = (
    <Pressable
      onPress={openPicker}
      style={
        bare
          ? {
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 12,
              paddingVertical: 13,
            }
          : {
              ...fieldBox,
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 11,
              paddingVertical: 11,
            }
      }
    >
      <Text
        numberOfLines={1}
        style={{ flex: 1, fontFamily: font.medium, fontSize: 13, color: shown ? ui.ink : ui.muted }}
      >
        {shown ?? placeholder}
      </Text>
      <Text style={{ fontFamily: font.bold, fontSize: 11, color: ui.muted, marginLeft: 6 }}>
        {"▾"}
      </Text>
    </Pressable>
  );

  return (
    <View style={style}>
      {bare ? (
        trigger
      ) : (
        <HardShadow radius={ui.rInput} offset={ui.shadowInput}>
          {trigger}
        </HardShadow>
      )}

      {Platform.OS === "ios" && (
        <BottomSheet
          visible={open}
          onClose={() => {
            // Dismissing accepts whatever the picker is showing - including the seeded default the
            // user never scrolled (onChange only fires on an actual change, so without this an
            // untouched value would never be committed).
            commit(temp);
            setOpen(false);
          }}
        >
          <View style={{ width: "100%", alignItems: "center" }}>
            <DateTimePicker
              value={temp}
              mode={mode}
              display={isDate ? "inline" : "spinner"}
              themeVariant="light"
              accentColor={ui.brand}
              textColor={ui.ink}
              minimumDate={gatedMin}
              maximumDate={gatedMax}
              minuteInterval={gatedInterval}
              onChange={(_event: DateTimePickerEvent, date?: Date) => {
                if (!date) return;
                // Save live - no Done button. The pink-highlighted selection is the confirmation;
                // the sheet is dismissed by tapping the backdrop (same for date and time).
                setTemp(date);
                commit(date);
              }}
            />
          </View>
        </BottomSheet>
      )}
    </View>
  );
}
