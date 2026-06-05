import { verifyToken } from "@clerk/backend";
import type { VerifyFn } from "./resolve.js";

// Networkless verification: checks the JWT signature against the instance public key
// (CLERK_JWT_KEY) without a round-trip to Clerk. name/email are present only if added to
// the session-token claims in the Clerk dashboard (see the manual ops checklist).
export const verifyClerkToken: VerifyFn = async (token) => {
  const jwtKey = process.env.CLERK_JWT_KEY;
  if (!jwtKey) throw new Error("CLERK_JWT_KEY is not set");

  const claims = await verifyToken(token, { jwtKey });
  const c = claims as Record<string, unknown>;
  return {
    sub: claims.sub,
    name: typeof c.name === "string" ? c.name : undefined,
    email: typeof c.email === "string" ? c.email : undefined,
  };
};
