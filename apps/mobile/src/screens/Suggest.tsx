import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Navigate } from "../../App";
import { trpc } from "../lib/trpc";
import { colors, radius, space } from "../theme";

type Group = Awaited<ReturnType<typeof trpc.groups.mine.query>>[number];
type Activity = NonNullable<Group["activeSuggestion"]>["activity"];
type WindowKey = "tonight" | "week" | "weekend";

const ACTIVITIES = [
  { key: "coffee", label: "Coffee" },
  { key: "food", label: "Food" },
  { key: "gym", label: "Gym" },
  { key: "study", label: "Study" },
  { key: "drinks", label: "Drinks" },
  { key: "anything", label: "Anything" },
] as const satisfies readonly { key: Activity; label: string }[];

const WINDOWS = [
  { key: "tonight", label: "Tonight" },
  { key: "week", label: "This week" },
  { key: "weekend", label: "Weekend" },
] as const satisfies readonly { key: WindowKey; label: string }[];

const DAY_MS = 24 * 60 * 60 * 1000;

// Build the loose window range for the chosen chip.
function windowRange(key: WindowKey): { start: string; end: string } {
  const now = new Date();
  const end = key === "tonight" ? new Date(now) : new Date(now.getTime() + 6 * DAY_MS);
  return { start: now.toISOString(), end: end.toISOString() };
}

// Suggest (the seed) — one tap to seed a meetup: pick an activity, a loose window,
// and the group. No time grid, no organising.
export function Suggest({ navigate }: { navigate: Navigate }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [windowKey, setWindowKey] = useState<WindowKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    trpc.groups.mine
      .query()
      .then((mine) => {
        setGroups(mine);
        if (mine[0]) setGroupId(mine[0].id);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const ready = groupId !== null && activity !== null && windowKey !== null;

  async function submit() {
    if (groupId === null || activity === null || windowKey === null || busy) return;
    setBusy(true);
    try {
      await trpc.suggestions.create.mutate({
        groupId,
        activity,
        window: windowRange(windowKey),
      });
      navigate({ name: "floating" });
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.center}>
        <Text style={s.calm}>Couldn't reach the server.</Text>
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>Suggest a meet</Text>

        <Text style={s.label}>What</Text>
        <View style={s.chips}>
          {ACTIVITIES.map((a) => {
            const on = activity === a.key;
            return (
              <Pressable
                key={a.key}
                style={[s.chip, on && s.chipOn]}
                onPress={() => setActivity(a.key)}
              >
                <Text style={[s.chipLabel, on && s.chipLabelOn]}>{a.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.label}>When</Text>
        <View style={s.chips}>
          {WINDOWS.map((w) => {
            const on = windowKey === w.key;
            return (
              <Pressable
                key={w.key}
                style={[s.chip, on && s.chipOn]}
                onPress={() => setWindowKey(w.key)}
              >
                <Text style={[s.chipLabel, on && s.chipLabelOn]}>{w.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.label}>Group</Text>
        <View style={s.chips}>
          {groups.map((g) => {
            const on = groupId === g.id;
            return (
              <Pressable
                key={g.id}
                style={[s.chip, on && s.chipOn]}
                onPress={() => setGroupId(g.id)}
              >
                <Text style={[s.chipLabel, on && s.chipLabelOn]}>{g.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={s.footer}>
        <Pressable
          style={[s.btn, s.primary, (!ready || busy) && s.dim]}
          disabled={!ready || busy}
          onPress={submit}
        >
          <Text style={s.primaryLabel}>Create</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingTop: 12 },
  scroll: { paddingHorizontal: 22, paddingBottom: 24 },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  calm: { fontSize: 15, color: colors.muted, textAlign: "center" },
  title: { fontSize: 30, fontWeight: "600", color: colors.ink, marginBottom: space.xl },
  label: { fontSize: 13.5, fontWeight: "600", color: colors.muted, marginBottom: space.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.xl },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipLabel: { fontSize: 14, fontWeight: "600", color: colors.ink },
  chipLabelOn: { color: colors.accentInk },
  footer: { paddingHorizontal: 22, paddingBottom: 28, paddingTop: space.sm },
  btn: { borderRadius: radius.lg, paddingVertical: 16, alignItems: "center" },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { fontSize: 15, fontWeight: "700", color: "#fff" },
  dim: { opacity: 0.4 },
});
