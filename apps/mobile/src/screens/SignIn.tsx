import { useSSO } from "@clerk/clerk-expo";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useDevAuth } from "../lib/auth";
import { devAuthEnabled } from "../lib/clerk";
import { colors, radius, space } from "../theme";

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
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.brand}>BeThere</Text>
        <Text style={styles.sub}>Plan real meetups with your groups.</Text>

        <Pressable style={styles.primary} onPress={onGoogle} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={styles.primaryText}>Continue with Google</Text>
          )}
        </Pressable>

        {devAuthEnabled ? (
          <Pressable style={styles.secondary} onPress={signInDev} disabled={busy}>
            <Text style={styles.secondaryText}>Continue as test user</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  card: { width: "100%", maxWidth: 360, paddingHorizontal: space.xl, gap: space.md },
  brand: { fontSize: 34, fontWeight: "700", color: colors.ink, textAlign: "center" },
  sub: { fontSize: 15, color: colors.muted, textAlign: "center", marginBottom: space.lg },
  primary: {
    backgroundColor: colors.accentInk,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: { color: colors.surface, fontSize: 16, fontWeight: "600" },
  secondary: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryText: { color: colors.ink, fontSize: 16, fontWeight: "600" },
});
