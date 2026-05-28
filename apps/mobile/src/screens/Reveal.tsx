import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Navigate } from "../../App";
import { trpc } from "../lib/trpc";
import { colors, radius, space } from "../theme";

type Plan = NonNullable<Awaited<ReturnType<typeof trpc.moments.plan.query>>>;

// It's on (the reveal) — "It clicked". Shows only the IN crowd (everyone here opted
// in, so it's safe to reveal them) plus the firm plan.
export function Reveal({ navigate, momentId }: { navigate: Navigate; momentId: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    trpc.moments.plan
      .query({ momentId })
      .then(setPlan)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [momentId]);

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

  if (!plan) {
    return (
      <View style={s.center}>
        <Text style={s.calm}>All set.</Text>
        <Pressable style={s.textBtn} onPress={() => navigate({ name: "home" })}>
          <Text style={s.textLabel}>Done</Text>
        </Pressable>
      </View>
    );
  }

  const others = plan.people.length - 1;

  return (
    <View style={s.screen}>
      <Text style={s.title}>It clicked</Text>
      <Text style={s.sub}>You're not the only one{"\n"}who wanted this.</Text>

      <View style={s.avs}>
        {plan.people.map((p, i) => (
          <View key={p.id} style={[s.av, { backgroundColor: p.color, marginLeft: i ? -12 : 0 }]}>
            <Text style={s.avText}>{p.name[0]}</Text>
          </View>
        ))}
      </View>
      <Text style={s.proof}>
        You + {others} {others === 1 ? "other" : "others"} are in
      </Text>

      <View style={s.plan}>
        <Text style={s.planTitle}>{plan.place}</Text>
        <Text style={s.planMeta}>{plan.detail}</Text>
      </View>

      <View style={s.spacer} />
      <Pressable style={[s.btn, s.primary]} onPress={() => undefined}>
        <Text style={s.primaryLabel}>Add to calendar</Text>
      </Pressable>
      <Pressable style={[s.btn, s.ghost]} onPress={() => navigate({ name: "home" })}>
        <Text style={s.ghostLabel}>Done</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 28,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  spacer: { flex: 1 },
  calm: { fontSize: 15, color: colors.muted, textAlign: "center" },
  title: { fontSize: 38, fontWeight: "600", color: colors.ink, textAlign: "center" },
  sub: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.muted,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 20,
  },
  avs: { flexDirection: "row", justifyContent: "center", marginTop: 30, marginBottom: 14 },
  av: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  avText: { fontSize: 16, fontWeight: "700", color: "#fff" },
  proof: { fontSize: 15.5, fontWeight: "700", color: colors.ink, textAlign: "center" },
  plan: {
    marginTop: space.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  planTitle: { fontSize: 17, fontWeight: "700", color: colors.ink },
  planMeta: { fontSize: 13.5, fontWeight: "500", color: colors.muted, marginTop: 5 },
  btn: { borderRadius: radius.lg, paddingVertical: 16, alignItems: "center", marginTop: space.sm },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { fontSize: 15, fontWeight: "700", color: "#fff" },
  ghost: { borderWidth: 1, borderColor: colors.line },
  ghostLabel: { fontSize: 15, fontWeight: "700", color: colors.ink },
  textBtn: { paddingVertical: 12, alignItems: "center", marginTop: space.md },
  textLabel: { fontSize: 15, fontWeight: "600", color: colors.muted },
});
