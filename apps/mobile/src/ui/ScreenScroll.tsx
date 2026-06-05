import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { ui } from "../theme";
import { ScreenBackground } from "./ScreenBackground";

// The standard screen shell: the gradient background + pinned `header`, over a padded ScrollView with
// the shared gutter. `bottomPad` overrides the bottom inset (e.g. for a pinned CTA); `footer` is a
// sibling of the scroll view (a pinned button bar); `avoidKeyboard` wraps the scroll in a
// KeyboardAvoidingView for form screens. Replaces the copy-pasted ScrollView shell in every screen.
export function ScreenScroll({
  header,
  children,
  footer,
  bottomPad = 24,
  avoidKeyboard = false,
}: {
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  bottomPad?: number;
  avoidKeyboard?: boolean;
}) {
  const scroll = (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: ui.gutter,
        paddingTop: 2,
        paddingBottom: bottomPad,
      }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {children}
    </ScrollView>
  );
  const body = avoidKeyboard ? (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {scroll}
    </KeyboardAvoidingView>
  ) : (
    scroll
  );
  return (
    <ScreenBackground header={header}>
      {footer ? (
        <>
          {body}
          {footer}
        </>
      ) : (
        body
      )}
    </ScreenBackground>
  );
}
