import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Navigate } from "../../App";
import { trpc } from "../lib/trpc";
import { colors, radius, space } from "../theme";

type Floater = Awaited<ReturnType<typeof trpc.availability.mine.query>>[number];
type Activity = Floater["activity"];

const EMOJI: Record<Activity, string> = {
  coffee: "☕",
  food: "🍜",
  gym: "🏋️",
  study: "📚",
  drinks: "🍻",
  anything: "✨",
};

// Floating (the calm wait) — your live availability, abstract by design: no counts,
// no names, nothing to refresh. A silent escape hatch per item. If a moment starts,
// drift gently into it.
export function Floating({ navigate }: { navigate: Navigate }) {
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [hasMoment, setHasMoment] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const [mine, moment] = await Promise.all([
      trpc.availability.mine.query(),
      trpc.moments.mine.query(),
    ]);
    setFloaters(mine);
    setHasMoment(moment !== null);
  }, []);

  useEffect(() => {
    let active = true;
    load()
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    // A quiet poll so a fired moment surfaces without anything to refresh.
    const id = setInterval(() => {
      load().catch(() => undefined);
    }, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [load]);

  async function withdraw(suggestionId: string) {
    if (busy) return;
    setBusy(true);
    try {
      await trpc.availability.withdraw.mutate({ suggestionId });
      await load();
    } catch {
      setError(true);
    } finally {
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
        <Text style={s.title}>Floating</Text>

        {hasMoment && (
          <Pressable style={s.banner} onPress={() => navigate({ name: "moment" })}>
            <Text style={s.bannerText}>It's coming together →</Text>
          </Pressable>
        )}

        {floaters.length === 0 && !hasMoment && (
          <Text style={s.calm}>Nothing floating right now.</Text>
        )}

        <View style={s.list}>
          {floaters.map((f) => (
            <View key={f.suggestionId} style={s.card}>
              <Text style={s.cardTitle}>
                {EMOJI[f.activity]} {f.activity}
              </Text>
              <Text style={s.status}>Floating</Text>
              <Pressable
                style={s.withdrawBtn}
                disabled={busy}
                onPress={() => withdraw(f.suggestionId)}
              >
                <Text style={s.withdrawLabel}>Withdraw quietly</Text>
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={s.footer}>
        <Pressable style={s.textBtn} onPress={() => navigate({ name: "home" })}>
          <Text style={s.textLabel}>Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingTop: 64 },
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
  banner: {
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    backgroundColor: colors.accentSoft,
    marginBottom: space.lg,
  },
  bannerText: { fontSize: 15, fontWeight: "600", color: colors.accentInk },
  list: { gap: space.md },
  card: {
    padding: 18,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  cardTitle: { fontSize: 17, fontWeight: "600", color: colors.ink, textTransform: "capitalize" },
  status: { fontSize: 13.5, fontWeight: "500", color: colors.muted, marginTop: 4 },
  withdrawBtn: { alignSelf: "flex-start", paddingVertical: 8, marginTop: space.sm },
  withdrawLabel: { fontSize: 14, fontWeight: "600", color: colors.muted },
  footer: { paddingHorizontal: 22, paddingBottom: 28, paddingTop: space.sm },
  textBtn: { paddingVertical: 12, alignItems: "center" },
  textLabel: { fontSize: 15, fontWeight: "600", color: colors.muted },
});
