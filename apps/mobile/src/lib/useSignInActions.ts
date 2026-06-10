import { useSSO } from "@clerk/clerk-expo";
import * as AuthSession from "expo-auth-session";
import { useState } from "react";
import { Platform } from "react-native";
import { useDevAuth } from "./auth";

// The shared Clerk Google-SSO + dev-bypass sign-in actions, used by both the SignIn screen and the
// JoinMeetup conversion funnel so they trigger sign-in identically. `busy` drives the button's
// "Connecting..." state. On web the SSO flow redirects (reloading the page); on native it returns a
// session inline. `WebBrowser.maybeCompleteAuthSession()` is called at SignIn module load (App always
// imports SignIn), which finalises the redirect on the landing page - no need to repeat it here.
export function useSignInActions(): {
  onGoogle: () => Promise<void>;
  signInDev: () => void;
  busy: boolean;
} {
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

  return { onGoogle, signInDev, busy };
}
