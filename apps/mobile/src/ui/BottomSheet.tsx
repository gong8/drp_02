import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, View } from "react-native";
import { ui } from "../theme";

// The scrim and the sheet are animated separately: the scrim fades in while only the sheet
// slides up. Modal's built-in animationType="slide" instead translates the whole tree, which
// drags the scrim's top edge up the screen as it opens (visibly wrong). We drive both off one
// 0->1 value and keep the modal mounted until the close animation finishes.
export function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(visible);
  const [sheetH, setSheetH] = useState(0);
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, anim]);

  if (!mounted) return null;

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetH || 600, 0],
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: ui.scrim,
            opacity: anim,
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={onClose} />
        </Animated.View>
        <Animated.View
          onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
          style={{
            transform: [{ translateY }],
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
        </Animated.View>
      </View>
    </Modal>
  );
}
