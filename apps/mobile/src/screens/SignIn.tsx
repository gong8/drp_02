import * as WebBrowser from "expo-web-browser";
import { Text, View } from "react-native";
import { devAuthEnabled } from "../lib/clerk";
import { useSignInActions } from "../lib/useSignInActions";
import { font, ui } from "../theme";
import { Button, ScreenBackground } from "../ui";

// Completes any pending OAuth redirect (web/native handoff back into the app). App always imports
// this module, so this runs on the redirect landing page even when JoinMeetup, not SignIn, is shown.
WebBrowser.maybeCompleteAuthSession();

export function SignIn() {
  const { onGoogle, signInDev, busy } = useSignInActions();

  return (
    <ScreenBackground>
      <View
        style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}
      >
        <Text style={{ fontFamily: font.black, fontSize: 44, letterSpacing: -1.5, color: ui.ink }}>
          BeThere
        </Text>
        <Text
          style={{
            fontFamily: font.medium,
            fontSize: 14,
            color: ui.muted,
            marginTop: 6,
            marginBottom: 28,
            textAlign: "center",
          }}
        >
          Plan real meetups with your groups.
        </Text>
        <View style={{ width: "100%", maxWidth: 320, gap: 12 }}>
          <Button
            label={busy ? "Connecting..." : "Continue with Google"}
            variant="primary"
            onPress={onGoogle}
            disabled={busy}
          />
          {devAuthEnabled ? (
            <Button
              label="Continue as test user"
              variant="outline"
              onPress={signInDev}
              disabled={busy}
            />
          ) : null}
        </View>
      </View>
    </ScreenBackground>
  );
}
