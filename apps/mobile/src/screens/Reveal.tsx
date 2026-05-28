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

  return (
    <View style={s.screen}>
      <Text style={s.title}>It clicked</Text>
      <Text style={s.sub}>You're not the only one{"\n"}who wanted this.</Text>

      <View style={s.plan}>
        <Text style={s.planTitle}>{plan.place}</Text>
        <Text style={s.planMeta}>{plan.detail}</Text>
      </View>

      <Text style={s.whoLabel}>Who's going</Text>
      <View style={s.who}>
        {plan.people.map((p) => (
          <View key={p.id} style={s.whoRow}>
            <View style={[s.whoAv, { backgroundColor: p.color }]}>
              <Text style={s.whoAvText}>{p.name[0]}</Text>
            </View>
            <Text style={s.whoName}>{p.name}</Text>
            <Text style={s.whoCheck}>✓</Text>
          </View>
        ))}
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
  whoLabel: {
    fontSize: 13.5,
    fontWeight: "600",
    color: colors.muted,
    marginTop: space.xl,
    marginBottom: space.md,
  },
  who: { gap: 9 },
  whoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
    backgroundColor: colors.surface,
  },
  whoAv: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  whoAvText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  whoName: { fontSize: 14, fontWeight: "600", color: colors.ink },
  whoCheck: { marginLeft: "auto", fontSize: 14, fontWeight: "700", color: colors.accent },
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
