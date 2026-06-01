// Pure auth-decision logic. The token verifier is injected so this is testable with no
// network and no DB. Returns a nullable userId; enforcement lives in protectedProcedure.

export type VerifiedClaims = { sub: string; name?: string; email?: string };

export type VerifyFn = (token: string) => Promise<VerifiedClaims>;

export type AuthInputs = {
  authHeader?: string; // raw "Authorization" header, e.g. "Bearer <jwt>"
  userIdHeader?: string; // raw "x-user-id" header (dev stub)
  devBypass: boolean; // true when DEV_AUTH_BYPASS is enabled
  clerkConfigured: boolean; // true when Clerk token verification is possible (CLERK_JWT_KEY set)
};

export type AuthResult = { userId: string | null; claims: VerifiedClaims | null };

const BEARER = "Bearer ";

export async function resolveAuth(inputs: AuthInputs, verify: VerifyFn): Promise<AuthResult> {
  const token = inputs.authHeader?.startsWith(BEARER)
    ? inputs.authHeader.slice(BEARER.length).trim()
    : undefined;

  // Only attempt verification when Clerk is actually configured. Locally CLERK_JWT_KEY is
  // unset, so a Clerk bearer token can't be verified - skip straight to the dev bypass
  // below instead of 401ing, which keeps local sign-in working as the seed user. In prod
  // CLERK_JWT_KEY is set, so real tokens verify and bad ones still resolve to null here.
  if (token && inputs.clerkConfigured) {
    try {
      const claims = await verify(token);
      return { userId: claims.sub, claims };
    } catch {
      // Invalid/expired token: treat as unauthenticated rather than a server error.
      return { userId: null, claims: null };
    }
  }

  if (inputs.devBypass) {
    return { userId: inputs.userIdHeader ?? "u_dev", claims: null };
  }

  return { userId: null, claims: null };
}
