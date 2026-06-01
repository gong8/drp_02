// Module-level auth state, updated by <AuthBridge/> (added in a later task) and read by the
// tRPC client. Kept outside React so the non-React tRPC client can attach the right header.

import { useAuth } from "@clerk/clerk-expo";
import type { ReactNode } from "react";
import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";

export type AuthMode = "clerk" | "dev" | null;

export type AuthHolder = {
  mode: AuthMode;
  devUserId: string | null;
  getToken: (() => Promise<string | null>) | null;
};

export const holder: AuthHolder = { mode: null, devUserId: null, getToken: null };

export async function buildAuthHeaders(h: AuthHolder): Promise<Record<string, string>> {
  if (h.mode === "dev" && h.devUserId) return { "x-user-id": h.devUserId };
  if (h.mode === "clerk" && h.getToken) {
    const token = await h.getToken();
    if (token) return { Authorization: `Bearer ${token}` };
  }
  return {};
}

type DevAuth = { devUser: string | null; signInDev: () => void; signOutDev: () => void };
const DevAuthContext = createContext<DevAuth>({
  devUser: null,
  signInDev: () => {},
  signOutDev: () => {},
});

export function DevAuthProvider({ children }: { children: ReactNode }) {
  const [devUser, setDevUser] = useState<string | null>(null);
  const value = useMemo<DevAuth>(
    () => ({
      devUser,
      signInDev: () => setDevUser("u_dev"),
      signOutDev: () => setDevUser(null),
    }),
    [devUser],
  );
  return createElement(DevAuthContext.Provider, { value }, children);
}

export function useDevAuth(): DevAuth {
  return useContext(DevAuthContext);
}

// Keeps the module-level holder in sync with Clerk + dev state. Render once inside both
// ClerkProvider and DevAuthProvider. Returns whether the app should consider the user authed.
export function useAuthBridge(): boolean {
  const { isSignedIn, getToken } = useAuth();
  const { devUser } = useDevAuth();

  useEffect(() => {
    if (devUser) {
      holder.mode = "dev";
      holder.devUserId = devUser;
      holder.getToken = null;
    } else if (isSignedIn) {
      holder.mode = "clerk";
      holder.devUserId = null;
      holder.getToken = () => getToken();
    } else {
      holder.mode = null;
      holder.devUserId = null;
      holder.getToken = null;
    }
  }, [devUser, isSignedIn, getToken]);

  return !!devUser || !!isSignedIn;
}
