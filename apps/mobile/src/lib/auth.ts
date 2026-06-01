// Module-level auth state, updated by <AuthBridge/> (added in a later task) and read by the
// tRPC client. Kept outside React so the non-React tRPC client can attach the right header.

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
