import type { ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import { ui } from "../theme";

export function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: ui.scrim }} onPress={onClose} />
      <View
        style={{
          backgroundColor: ui.surface,
          borderTopWidth: ui.border,
          borderLeftWidth: ui.border,
          borderRightWidth: ui.border,
          borderColor: ui.ink,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          padding: 16,
          paddingBottom: 28,
        }}
      >
        <View
          style={{
            width: 38,
            height: 4,
            borderRadius: 2,
            backgroundColor: ui.ink,
            opacity: 0.25,
            alignSelf: "center",
            marginBottom: 14,
          }}
        />
        {children}
      </View>
    </Modal>
  );
}
