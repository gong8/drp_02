import { type AuthHolder, buildAuthHeaders } from "../src/lib/auth";

it("returns x-user-id in dev mode", async () => {
  const holder: AuthHolder = { mode: "dev", devUserId: "u_dev", getToken: null };
  expect(await buildAuthHeaders(holder)).toEqual({ "x-user-id": "u_dev" });
});

it("returns a bearer header in clerk mode", async () => {
  const holder: AuthHolder = { mode: "clerk", devUserId: null, getToken: async () => "jwt123" };
  expect(await buildAuthHeaders(holder)).toEqual({ Authorization: "Bearer jwt123" });
});

it("returns no auth headers when signed out", async () => {
  const holder: AuthHolder = { mode: null, devUserId: null, getToken: null };
  expect(await buildAuthHeaders(holder)).toEqual({});
});

it("returns no headers if clerk getToken yields null", async () => {
  const holder: AuthHolder = { mode: "clerk", devUserId: null, getToken: async () => null };
  expect(await buildAuthHeaders(holder)).toEqual({});
});
