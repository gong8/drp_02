// Pull the tRPC error code (e.g. "NOT_FOUND") off a client error, if present, so a screen can branch
// a known outcome (not-found) from a generic network failure. A pure helper kept separate from the
// trpc client module so screens can use it without pulling in (or having to mock) the network client.
export function trpcErrorCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "data" in e) {
    const data = (e as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) {
      const code = (data as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
  }
  return undefined;
}
