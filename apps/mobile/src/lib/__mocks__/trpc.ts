// Manual jest mock of the vanilla tRPC client (src/lib/trpc.ts). The real client makes HTTP
// calls; this replaces every procedure with a jest.fn() so screen tests can drive UI off canned
// server responses. Any path resolves lazily, so it never drifts from the router:
//
//   jest.mock("../../lib/trpc");                       // top of the test file
//   import { trpc } from "../../lib/trpc";
//   import { mockQuery, resetTrpcMock } from "../../lib/__mocks__/trpc";
//   beforeEach(resetTrpcMock);
//   mockQuery(trpc.events.mine, [ ...plans ]);          // typed helper, no casts in the test
//
// The exported `trpc` is typed as the real client (via `typeof import("../trpc")`), so screens
// and tests keep full type safety; only the runtime behavior is swapped.

const calls = new Map<string, ReturnType<typeof jest.fn>>();

function leaf(path: string): ReturnType<typeof jest.fn> {
  let fn = calls.get(path);
  if (!fn) {
    fn = jest.fn();
    calls.set(path, fn);
  }
  return fn;
}

function branch(prefix: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== "string") return undefined;
        if (key === "query" || key === "mutate") return leaf(`${prefix}.${key}`);
        return branch(prefix ? `${prefix}.${key}` : key);
      },
    },
  );
}

export const trpc = branch("") as unknown as typeof import("../trpc")["trpc"];

// Reset every recorded mock between tests. Call in beforeEach so canned responses never leak.
export function resetTrpcMock(): void {
  for (const fn of calls.values()) fn.mockReset();
}

// Typed helpers so tests configure responses without casting at the call site. `proc` is a
// procedure like `trpc.events.mine`; we read its .query/.mutate jest.fn and set the resolved value.
// The local Resolvable interface sidesteps jest.Mock's `never`-typed mockResolvedValue parameter.
interface Resolvable<T> {
  mockResolvedValue(value: T): unknown;
  mockRejectedValue(error: unknown): unknown;
}
type QueryProc<T> = { query: (...args: never[]) => Promise<T> };
type MutationProc<T> = { mutate: (...args: never[]) => Promise<T> };

export function mockQuery<T>(proc: QueryProc<T>, value: T): void {
  (proc.query as unknown as Resolvable<T>).mockResolvedValue(value);
}

export function mockQueryError(proc: { query: unknown }, error: unknown): void {
  (proc.query as unknown as Resolvable<unknown>).mockRejectedValue(error);
}

export function mockMutation<T>(proc: MutationProc<T>, value: T): void {
  (proc.mutate as unknown as Resolvable<T>).mockResolvedValue(value);
}

export function mockMutationError(proc: { mutate: unknown }, error: unknown): void {
  (proc.mutate as unknown as Resolvable<unknown>).mockRejectedValue(error);
}
