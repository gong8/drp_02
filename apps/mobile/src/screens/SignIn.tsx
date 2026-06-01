import { useSSO } from "@clerk/clerk-expo";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { useDevAuth } from "../lib/auth";
import { devAuthEnabled } from "../lib/clerk";
import { font, ui } from "../theme";
import { Button, ScreenBackground } from "../ui";

// Completes any pending OAuth redirect (web/native handoff back into the app).
WebBrowser.maybeCompleteAuthSession();

export function SignIn() {
  const { startSSOFlow } = useSSO();
  const { signInDev } = useDevAuth();
  const [busy, setBusy] = useState(false);

  const onGoogle = async () => {
    setBusy(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
        // Web defaults to current path; native must use the app scheme.
        redirectUrl:
          Platform.OS === "web" ? undefined : AuthSession.makeRedirectUri({ scheme: "bethere" }),
      });
      if (createdSessionId && setActive) await setActive({ session: createdSessionId });
    } catch (err) {
      console.error("sign-in failed", JSON.stringify(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenBackground>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
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
