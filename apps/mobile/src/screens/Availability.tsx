import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Navigate } from "../../App";
import { trpc } from "../lib/trpc";
import { colors, radius, space } from "../theme";

type Suggestion = NonNullable<Awaited<ReturnType<typeof trpc.suggestions.get.query>>>;
type PartOfDay = "morning" | "afternoon" | "evening";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const PARTS = [
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
] as const satisfies readonly { key: PartOfDay; label: string }[];

// Turn "YYYY-MM-DD" into a calm "Thu 29" label.
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}`;
}

// Availability (private) — pick loose slots within the window. The lock line is the
// ONLY reassurance; nothing else is said. Submitting floats the availability.
export function Availability({
  navigate,
  suggestionId,
}: {
  navigate: Navigate;
  suggestionId: string;
}) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [parts, setParts] = useState<PartOfDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    trpc.suggestions.get
      .query({ id: suggestionId })
      .then(setSuggestion)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [suggestionId]);

  const ready = days.length > 0 && parts.length > 0;

  async function drop() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const slots = days.flatMap((day) => parts.map((partOfDay) => ({ day, partOfDay })));
      const res = await trpc.availability.drop.mutate({ suggestionId, slots });
      navigate(res.firedMomentId ? { name: "moment" } : { name: "floating" });
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

  if (!suggestion) {
    return (
      <View style={s.center}>
        <Text style={s.calm}>That suggestion is no longer open.</Text>
        <Pressable style={s.textBtn} onPress={() => navigate({ name: "home" })}>
          <Text style={s.textLabel}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>
          {suggestion.byName} suggested {suggestion.activity} — when are you free?
        </Text>

        <Text style={s.label}>Days</Text>
        <View style={s.chips}>
          {suggestion.days.map((day) => {
            const on = days.includes(day);
            return (
              <Pressable
                key={day}
                style={[s.chip, on && s.chipOn]}
                onPress={() =>
                  setDays((prev) => (on ? prev.filter((x) => x !== day) : [...prev, day]))
                }
              >
                <Text style={[s.chipLabel, on && s.chipLabelOn]}>{dayLabel(day)}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.label}>Time of day</Text>
        <View style={s.chips}>
          {PARTS.map((p) => {
            const on = parts.includes(p.key);
            return (
              <Pressable
                key={p.key}
                style={[s.chip, on && s.chipOn]}
                onPress={() =>
                  setParts((prev) => (on ? prev.filter((x) => x !== p.key) : [...prev, p.key]))
                }
              >
                <Text style={[s.chipLabel, on && s.chipLabelOn]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.lock}>Private — only you see this.</Text>
      </ScrollView>

      <View style={s.footer}>
        <Pressable
          style={[s.btn, s.primary, (!ready || busy) && s.dim]}
          disabled={!ready || busy}
          onPress={drop}
        >
          <Text style={s.primaryLabel}>Drop availability</Text>
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
  title: {
    fontSize: 26,
    fontWeight: "600",
    color: colors.ink,
    marginBottom: space.xl,
    lineHeight: 32,
  },
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
  lock: { fontSize: 13, fontWeight: "500", color: colors.muted, marginTop: space.sm },
  footer: { paddingHorizontal: 22, paddingBottom: 28, paddingTop: space.sm },
  btn: { borderRadius: radius.lg, paddingVertical: 16, alignItems: "center" },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { fontSize: 15, fontWeight: "700", color: "#fff" },
  dim: { opacity: 0.4 },
  textBtn: { paddingVertical: 12, alignItems: "center", marginTop: space.md },
  textLabel: { fontSize: 15, fontWeight: "600", color: colors.muted },
});
