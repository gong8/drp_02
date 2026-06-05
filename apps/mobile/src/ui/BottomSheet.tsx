import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Easing, Keyboard, Modal, Platform, Pressable, View } from "react-native";
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
  // Live keyboard height. We slide the sheet up by exactly this, driven off the keyboard's OWN
  // show/hide event and animated with the keyboard's own duration - so it tracks the keyboard in
  // lockstep. (KeyboardAvoidingView animates a layout padding on its own timer inside the Modal,
  // which crawls up visibly out of sync; this transform-based lift is native-driven and smooth.)
  const kb = useRef(new Animated.Value(0)).current;

  // iOS fires keyboardWillShow/Hide *before* the keyboard animates and carries its duration;
  // Android only reliably fires the Did* events (no duration), so fall back to a short default.
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => {
      Animated.timing(kb, {
        toValue: e.endCoordinates.height,
        duration: e.duration || 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    const hide = Keyboard.addListener(hideEvt, (e) => {
      Animated.timing(kb, {
        toValue: 0,
        duration: e?.duration || 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [kb]);

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

  // Open/close slide, then lifted by the live keyboard height so the lower fields (Notes) and the
  // Save button stay visible while typing. Both operands are native-driven, so the subtract is too.
  const translateY = Animated.subtract(
    anim.interpolate({ inputRange: [0, 1], outputRange: [sheetH || 600, 0] }),
    kb,
  );

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
