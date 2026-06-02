import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { font, ui } from "../theme";
import { BottomSheet } from "./BottomSheet";
import type { DateTimeFieldProps } from "./DateTimeField.types";
import { HardShadow } from "./HardShadow";

// Themed wrapper around the inbuilt native date/time picker
// (@react-native-community/datetimepicker, bundled in Expo Go). The trigger mirrors the
// `Field` look; tapping opens the native picker - on iOS inside our `BottomSheet`
// (date = inline calendar tinted with brand pink; time = wheel snapped to `minuteInterval`),
// on Android via the imperative dialog. Output strings match `isoFrom` in CreateEvent.

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeString(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function roundUpToInterval(d: Date, interval: number): Date {
  const out = new Date(d);
  out.setSeconds(0, 0);
  const rem = out.getMinutes() % interval;
  if (rem !== 0) out.setMinutes(out.getMinutes() + (interval - rem));
  return out;
}

// Seed the picker from the current value, falling back to a sensible "now".
function seed(mode: "date" | "time", value: string, interval: number): Date {
  const now = new Date();
  if (mode === "date") {
    if (value) {
      const d = new Date(`${value}T00:00:00`);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return now;
  }
  if (value) {
    const d = new Date(`1970-01-01T${value}:00`);
    if (!Number.isNaN(d.getTime())) {
      const t = new Date();
      t.setHours(d.getHours(), d.getMinutes(), 0, 0);
      return t;
    }
  }
  return roundUpToInterval(now, interval);
}

// Friendly trigger label (e.g. "Fri, 5 Jun" / "4:00 PM"); null when unset.
function displayValue(mode: "date" | "time", value: string): string | null {
  if (!value) return null;
  if (mode === "date") {
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }
  const d = new Date(`1970-01-01T${value}:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function DateTimeField({
  label,
  mode,
  value,
  onChange,
  minuteInterval = 15,
  minimumDate,
  style,
}: DateTimeFieldProps) {
  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState<Date>(() => seed(mode, value, minuteInterval));

  const shown = displayValue(mode, value);
  const placeholder = mode === "date" ? "Pick a date" : "Pick a time";

  function commit(d: Date) {
    onChange(mode === "date" ? toDateString(d) : toTimeString(d));
  }

  function openPicker() {
    const initial = seed(mode, value, minuteInterval);
    setTemp(initial);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: initial,
        mode,
        is24Hour: false,
        minuteInterval: mode === "time" ? minuteInterval : undefined,
        minimumDate: mode === "date" ? minimumDate : undefined,
        display: mode === "date" ? "calendar" : "clock",
        onChange: (event: DateTimePickerEvent, date?: Date) => {
          if (event.type === "set" && date) commit(date);
        },
      });
      return;
    }
    setOpen(true);
  }

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
        <Pressable
          onPress={openPicker}
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: ui.surface,
            borderWidth: ui.border,
            borderColor: ui.ink,
            borderRadius: ui.rInput,
            paddingHorizontal: 11,
            paddingVertical: 11,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontFamily: font.medium,
              fontSize: 13,
              color: shown ? ui.ink : ui.muted,
            }}
          >
            {shown ?? placeholder}
          </Text>
          <Text style={{ fontFamily: font.bold, fontSize: 11, color: ui.muted, marginLeft: 6 }}>
            {"▾"}
          </Text>
        </Pressable>
      </HardShadow>

      {Platform.OS === "ios" && (
        <BottomSheet visible={open} onClose={() => setOpen(false)}>
          <Text
            style={{
              fontFamily: font.bold,
              fontSize: 9,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: ui.ink,
              marginBottom: 10,
            }}
          >
            {placeholder}
          </Text>
          <View style={{ width: "100%", alignItems: "center" }}>
            <DateTimePicker
              value={temp}
              mode={mode}
              display={mode === "date" ? "inline" : "spinner"}
              themeVariant="light"
              accentColor={ui.brand}
              textColor={ui.ink}
              minimumDate={mode === "date" ? minimumDate : undefined}
              minuteInterval={mode === "time" ? minuteInterval : undefined}
              onChange={(_event: DateTimePickerEvent, date?: Date) => {
                if (!date) return;
                setTemp(date);
                // Save live - no Done button. A date is a single terminal tap, so close the sheet
                // as soon as it's chosen; the time wheel has no discrete "selected" event, so it
                // keeps saving as you scroll and is dismissed by tapping the backdrop.
                commit(date);
                if (mode === "date") setOpen(false);
              }}
            />
          </View>
        </BottomSheet>
      )}
    </View>
  );
}
