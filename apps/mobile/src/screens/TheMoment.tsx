import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { trpc } from "../lib/trpc";
import { colors, radius, space } from "../theme";

type Proposal = NonNullable<Awaited<ReturnType<typeof trpc.moments.mine.query>>>;
type Outcome = Awaited<ReturnType<typeof trpc.moments.resolve.mutate>>;

const EMOJI: Record<Proposal["activity"], string> = {
  coffee: "☕",
  food: "🍜",
  gym: "🏋️",
  study: "📚",
  drinks: "🍻",
  anything: "✨",
};

// The whole "moment" loop on one screen (no navigation): load the proposal, answer
// Yes/No, run the buzzer, then reveal "It clicked" or let it quietly fizzle.
export function TheMoment() {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    trpc.moments.mine
      .query()
      .then(setProposal)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  async function answer(kind: "yes" | "no") {
    if (!proposal || busy) return;
    setBusy(true);
    try {
      // Record the answer (blind), then trip the buzzer to resolve clear vs fizzle.
      await trpc.moments.respond.mutate({ momentId: proposal.id, kind });
      setOutcome(await trpc.moments.resolve.mutate({ momentId: proposal.id }));
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

  // It clicked — reveal the IN crowd (safe: everyone shown opted in).
  if (outcome?.status === "cleared") {
    const others = outcome.inCount - 1;
    return (
      <View style={s.screen}>
        <Text style={s.revealTitle}>It clicked</Text>
        <Text style={s.sub}>You're not the only one{"\n"}who wanted this.</Text>
        <Text style={s.proof}>
          You + {others} {others === 1 ? "other" : "others"} are in
        </Text>
        {proposal && (
          <PlanCard activity={proposal.activity} place={proposal.place} detail={proposal.detail} />
        )}
        <View style={s.spacer} />
        <Pressable style={[s.btn, s.primary]} onPress={() => undefined}>
          <Text style={s.primaryLabel}>Add to calendar</Text>
        </Pressable>
      </View>
    );
  }

  // Silent fizzle — it simply fades. No "failed" state, no trace.
  if (outcome?.status === "fizzled") {
    return (
      <View style={s.center}>
        <Text style={s.calm}>That one quietly passed.</Text>
      </View>
    );
  }

  // No live moment (e.g. after it has already resolved).
  if (!proposal) {
    return (
      <View style={s.center}>
        <Text style={s.calm}>Nothing on right now.</Text>
      </View>
    );
  }

  // The proposal — blind and timed in the real product; here, the core decision.
  return (
    <View style={s.screen}>
      <Text style={s.eyebrow}>It's coming together</Text>
      <Text style={s.title}>{proposal.title}</Text>
      <PlanCard activity={proposal.activity} place={proposal.place} detail={proposal.detail} />
      <View style={s.spacer} />

      <Pressable
        style={[s.btn, s.primary, busy && s.dim]}
        disabled={busy}
        onPress={() => answer("yes")}
      >
        <Text style={s.primaryLabel}>I'm in</Text>
      </Pressable>

      {/* Stub: the "I'm in if…" picker needs the participant list, which the server
          intentionally hides during the window. Deferred in this skeleton. */}
      <Pressable style={[s.btn, s.ghost, s.dim]} disabled>
        <Text style={s.ghostLabel}>I'm in if…</Text>
      </Pressable>
      <Text style={s.stubNote}>Picker coming soon</Text>

      <Pressable style={s.textBtn} disabled={busy} onPress={() => answer("no")}>
        <Text style={s.textLabel}>Can't make it</Text>
      </Pressable>
    </View>
  );
}

function PlanCard(props: { activity: Proposal["activity"]; place: string; detail: string }) {
  return (
    <View style={s.plan}>
      <Text style={s.planTitle}>
        {EMOJI[props.activity]} {props.place}
      </Text>
      <Text style={s.planMeta}>{props.detail}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 22,
    paddingTop: 72,
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
  eyebrow: { fontSize: 13.5, fontWeight: "600", color: colors.muted, marginBottom: space.sm },
  title: { fontSize: 31, fontWeight: "600", color: colors.ink },
  revealTitle: {
    fontSize: 37,
    fontWeight: "600",
    color: colors.ink,
    textAlign: "center",
    marginTop: 8,
  },
  sub: { fontSize: 14, color: colors.muted, textAlign: "center", marginTop: 12, lineHeight: 20 },
  proof: {
    fontSize: 15.5,
    fontWeight: "700",
    color: colors.ink,
    textAlign: "center",
    marginTop: 22,
  },
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
  dim: { opacity: 0.4 },
  stubNote: { fontSize: 12, color: colors.muted, textAlign: "center", marginTop: space.xs },
  textBtn: { paddingVertical: 12, alignItems: "center", marginTop: space.xs },
  textLabel: { fontSize: 15, fontWeight: "600", color: colors.muted },
});
