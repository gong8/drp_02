import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

// Native persists the session token in the secure enclave; web uses Clerk's own storage,
// so we pass undefined there.
export const tokenCache =
  Platform.OS === "web"
    ? undefined
    : {
        getToken: (key: string) => SecureStore.getItemAsync(key),
        saveToken: (key: string, value: string) => SecureStore.setItemAsync(key, value),
      };

// Shown the dev-bypass button only in CD/dev builds.
export const devAuthEnabled = process.env.EXPO_PUBLIC_DEV_AUTH === "1";
