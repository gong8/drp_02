import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";
import { ui } from "../theme";
import { Button } from "./Button";
import { AppText } from "./Text";

// The single "add a candidate" affordance, shared by the time list and the activity list so they read
// and behave identically. Collapsed it is a dashed "empty slot" row in the same geometry as the
// candidate rows above it; open it reveals the caller's input(s) (`children`) over a themed
// Add / Cancel button row. The caller owns the draft state and does the actual add in `onSubmit`;
// `onCancel` resets that draft. This closes itself on either.
export function AddComposer({
  triggerLabel,
  canSubmit,
  onSubmit,
  onCancel,
  onToggle,
  busy = false,
  children,
}: {
  triggerLabel: string;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  // Reports open/closed so a parent can react to "the user is mid-compose" (e.g. hide a sticky CTA).
  onToggle?: (open: boolean) => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Flip open AND notify the parent in one place, so every entry/exit path stays in sync.
  const setOpenAndReport = (next: boolean) => {
    setOpen(next);
    onToggle?.(next);
  };
  if (!open) {
    return (
      <Pressable
        onPress={() => setOpenAndReport(true)}
        style={{
          alignItems: "center",
          paddingVertical: 11,
          paddingHorizontal: 13,
          borderRadius: ui.rInput,
          borderWidth: ui.border,
          borderColor: ui.ink,
          borderStyle: "dashed",
        }}
      >
        <AppText variant="rowLabelSm">{triggerLabel}</AppText>
      </Pressable>
    );
  }
  return (
    <View style={{ marginTop: 6 }}>
      {children}
      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
        <Button
          size="sm"
          label="Add"
          disabled={!canSubmit || busy}
          onPress={() => {
            onSubmit();
            setOpenAndReport(false);
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          label="Cancel"
          onPress={() => {
            onCancel?.();
            setOpenAndReport(false);
          }}
        />
      </View>
    </View>
  );
}
