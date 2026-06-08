import { UpdateProfileInput } from "@bethere/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { getUserCard } from "../db/users.js";
import { protectedProcedure, router } from "../trpc.js";

export const usersRouter = router({
  // The signed-in user's own avatar card (id, name, colour). Drives the Account screen's editable
  // name field by reading the SERVER-side display name - the same name shown in rosters - rather
  // than the Clerk token, so an edit here is what other members see.
  me: protectedProcedure.query(({ ctx }) => getUserCard(ctx.userId)),

  // Set the caller's own display name. Onboarding fix: Google sign-ins whose token carried no name
  // default to "Member" in rosters; this lets a member put their real name in. The name is trimmed
  // and length-checked by DisplayName at the boundary.
  updateProfile: protectedProcedure.input(UpdateProfileInput).mutation(async ({ ctx, input }) => {
    await db.update(users).set({ name: input.name }).where(eq(users.id, ctx.userId));
    return { ok: true as const };
  }),
});
