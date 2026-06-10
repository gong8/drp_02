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
  busy = false,
  children,
}: {
  triggerLabel: string;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
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
            setOpen(false);
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          label="Cancel"
          onPress={() => {
            onCancel?.();
            setOpen(false);
          }}
        />
      </View>
    </View>
  );
}
