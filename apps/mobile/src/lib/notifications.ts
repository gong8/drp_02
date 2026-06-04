import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { formatSlot } from "./format";
import type { trpc } from "./trpc"; // type-only: server code is never bundled

// The dashboard payload fields a reminder needs - a compiler-enforced subset of an events.mine row.
// Deriving via Pick<> keeps the subset honest (a renamed/dropped field breaks the build) and gives
// phase/myStatus their real pgEnum / MyStatus unions, so a literal typo fails typecheck.
export type ReminderEvent = Pick<
  Awaited<ReturnType<typeof trpc.events.mine.query>>[number],
  "id" | "title" | "phase" | "myStatus" | "iReacted" | "lockAt" | "momentEndsAt"
>;

// A brewing float, for the "pile on before it tips" nudge. A subset of a floats.mine row - no title
// (floats are unsigned) and no names. Once it tips it becomes a normal moment and the event
// reminders above take over.
export type ReminderFloat = Pick<
  Awaited<ReturnType<typeof trpc.floats.mine.query>>[number],
  "id" | "groupName" | "tipAt"
>;

// Show a banner even when the app is foregrounded, so a co-located demo still "dings".
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const LOCK_LEAD_MS = 60 * 60 * 1000; // "locks soon" reminder this far before the deadline
const RSVP_LEAD_MS = 15 * 60 * 1000; // "RSVP closing" reminder this far before the moment ends
const FLOAT_LEAD_MS = 30 * 60 * 1000; // "pile on" nudge this far before a float tips

let permissionAsked = false;
let lastSignature = "";

// Ask for notification permission once (and set up the Android channel). Returns whether granted.
// Best-effort: notifications are a nicety, so any failure resolves to "not granted".
export async function ensurePermission(): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Reminders",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted" && !permissionAsked) {
      permissionAsked = true;
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    return status === "granted";
  } catch {
    return false;
  }
}

// Re-derive local reminders from the current dashboard payload: cancel everything we scheduled and
// reschedule. Idempotent, so opting out / answering simply drops a plan's pings on the next sync.
// A signature guard makes the 5s dashboard poll a no-op unless a reminder-relevant field changed.
// NOTE: device-local only - it can only schedule for plans this device has already loaded (see
// docs/tech-debt.md). Verify on a real Expo Go device; remote push needs a dev build.
export async function syncReminders(
  events: ReminderEvent[],
  floats: ReminderFloat[] = [],
): Promise<void> {
  const signature = `${events
    .map((e) => `${e.id}:${e.phase}:${e.myStatus}:${e.iReacted}:${e.lockAt}:${e.momentEndsAt}`)
    .join("|")}#${floats.map((f) => `${f.id}:${f.tipAt}`).join("|")}`;
  if (signature === lastSignature) return;

  try {
    const granted = await ensurePermission();
    if (!granted) return;
    await Notifications.cancelAllScheduledNotificationsAsync();
    const now = Date.now();

    for (const e of events) {
      if (e.myStatus === "declined") continue; // opted out / not coming - no pings

      if (e.phase === "collecting" && e.lockAt) {
        const lockMs = new Date(e.lockAt).getTime();
        if (!e.iReacted && lockMs - LOCK_LEAD_MS > now) {
          await schedule(
            new Date(lockMs - LOCK_LEAD_MS),
            "Locks soon",
            `"${e.title}" locks ${formatSlot(e.lockAt)} - tap the times you can make.`,
          );
        }
        if (lockMs > now) {
          await schedule(
            new Date(lockMs),
            "Who's in?",
            `"${e.title}" just opened for the moment - say if you're in.`,
          );
        }
      }

      if (e.phase === "moment" && e.myStatus === "awaiting" && e.momentEndsAt) {
        await scheduleLead(
          e.momentEndsAt,
          RSVP_LEAD_MS,
          now,
          "RSVP closing",
          `"${e.title}" - are you in? Closing soon.`,
        );
      }
    }

    // Brewing floats: a "pile on before it tips" nudge. No names, no title (floats are unsigned);
    // once it tips it surfaces as a moment above and gets the normal RSVP reminder.
    for (const f of floats) {
      if (!f.tipAt) continue;
      await scheduleLead(
        f.tipAt,
        FLOAT_LEAD_MS,
        now,
        "An idea is brewing",
        `Something's brewing in ${f.groupName} - pile on before it tips.`,
      );
    }
    // Only mark the signature once a full reschedule succeeded, so a transient failure retries next time.
    lastSignature = signature;
  } catch {
    // best-effort: never let a notification hiccup break the dashboard
  }
}

// Schedule a "fires leadMs before iso" reminder, but only if that lead time is still in the future.
async function scheduleLead(
  iso: string,
  leadMs: number,
  now: number,
  title: string,
  body: string,
): Promise<void> {
  const at = new Date(iso).getTime() - leadMs;
  if (at > now) await schedule(new Date(at), title, body);
}

async function schedule(date: Date, title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
  });
}
