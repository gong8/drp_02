import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { formatSlot } from "./format";
import type { trpc } from "./trpc"; // type-only: server code is never bundled

// The dashboard payload fields a reminder needs - a compiler-enforced subset of an events.mine row.
// Deriving via Pick<> keeps the subset honest (a renamed/dropped field breaks the build) and gives
// phase/myStatus their real pgEnum / MyStatus unions, so a literal typo fails typecheck.
export type ReminderEvent = Pick<
  Awaited<ReturnType<typeof trpc.events.mine.query>>[number],
  | "id"
  | "activity"
  | "groupName"
  | "phase"
  | "myStatus"
  | "iReacted"
  | "iResponded"
  | "decidesBy"
  | "momentStartsAt"
  | "momentEndsAt"
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

const DECIDE_LEAD_MS = 60 * 60 * 1000; // "decides soon" reminder this far before the deadline
const RSVP_LEAD_MS = 15 * 60 * 1000; // "RSVP closing" reminder this far before the moment ends
// How recently a moment must have opened for us to (re)fire the "just opened" ping. The collecting
// branch schedules that ping for the decides-by instant, but the collecting->moment flip changes the
// sync signature and cancels every pending notification (cancelAllScheduledNotificationsAsync), so the
// moment branch re-arms it here. A small window keeps us from re-pinging a moment that opened long ago.
const MOMENT_OPEN_WINDOW_MS = 10 * 60 * 1000;

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
export async function syncReminders(events: ReminderEvent[]): Promise<void> {
  const signature = events
    .map((e) => `${e.id}:${e.phase}:${e.myStatus}:${e.iReacted}:${e.decidesBy}:${e.momentEndsAt}`)
    .join("|");
  if (signature === lastSignature) return;

  try {
    const granted = await ensurePermission();
    if (!granted) return;
    await Notifications.cancelAllScheduledNotificationsAsync();
    const now = Date.now();

    for (const e of events) {
      if (e.myStatus === "declined") continue; // opted out / not coming - no pings

      if (e.phase === "collecting" && e.decidesBy) {
        const decideMs = new Date(e.decidesBy).getTime();
        if (!e.iReacted && decideMs - DECIDE_LEAD_MS > now) {
          await schedule(
            new Date(decideMs - DECIDE_LEAD_MS),
            "Decides soon",
            `"${e.activity || e.groupName}" decides ${formatSlot(e.decidesBy)} - tap what you're keen on.`,
          );
        }
        if (decideMs > now) {
          await schedule(
            new Date(decideMs),
            "Who's in?",
            `"${e.activity || e.groupName}" just opened for the moment - say if you're in.`,
          );
        }
      }

      if (e.phase === "moment" && e.myStatus === "awaiting" && e.momentEndsAt) {
        // Re-arm the "just opened for the moment" ping the collecting branch lost when this plan
        // flipped collecting->moment (the phase change cancelled the pending notification above). Only
        // when the moment opened within the last few minutes and the user has not responded yet, so we
        // fire it once near the transition and never re-ping a long-open moment on a later sync.
        if (!e.iResponded && e.momentStartsAt) {
          const startedMs = new Date(e.momentStartsAt).getTime();
          if (now - startedMs >= 0 && now - startedMs <= MOMENT_OPEN_WINDOW_MS) {
            await schedule(
              new Date(now),
              "Who's in?",
              `"${e.activity || e.groupName}" just opened for the moment - say if you're in.`,
            );
          }
        }
        await scheduleLead(
          e.momentEndsAt,
          RSVP_LEAD_MS,
          now,
          "RSVP closing",
          `"${e.activity || e.groupName}" - are you in? Closing soon.`,
        );
      }
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
