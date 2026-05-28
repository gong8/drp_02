import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { Navigate } from "../../App";
import { trpc } from "../lib/trpc";
import { colors, radius, space } from "../theme";

type Proposal = NonNullable<Awaited<ReturnType<typeof trpc.moments.mine.query>>>;
type Member = Proposal["members"][number];
type Mode = "all" | "any";

// Format remaining milliseconds as "m:ss left", clamped at zero.
function formatLeft(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} left`;
}

// The moment (the heart) — blind & timed. Load the proposal, answer Yes / If… / No,
// resolve at the buzzer, then reveal "It clicked" or let it quietly fizzle. Never shows
// other responses or a tally.
export function TheMoment({ navigate }: { navigate: Navigate }) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [msLeft, setMsLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const [sheet, setSheet] = useState(false);
  const [mode, setMode] = useState<Mode>("all");
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    trpc.moments.mine
      .query()
      .then((p) => {
        setProposal(p);
        if (p) setMsLeft(p.msLeft);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // Tick the countdown down locally each second, clamped at zero.
  useEffect(() => {
    if (!proposal) return;
    const id = setInterval(() => {
      setMsLeft((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [proposal]);

  async function answer(
    kind: "yes" | "no" | "conditional",
    cond?: { mode: Mode; targetIds: string[] },
  ) {
    if (!proposal || busy) return;
    setBusy(true);
    try {
      // Record the answer (blind), then trip the buzzer to resolve clear vs fizzle.
      await trpc.moments.respond.mutate(
        cond ? { momentId: proposal.id, kind, cond } : { momentId: proposal.id, kind },
      );
      const outcome = await trpc.moments.resolve.mutate({ momentId: proposal.id });
      if (outcome.status === "cleared") {
        navigate({ name: "reveal", momentId: proposal.id });
      } else {
        // Silent fizzle — no "failed" state, just back to the calm home.
        navigate({ name: "home" });
      }
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

  if (!proposal) {
    return (
      <View style={s.center}>
        <Text style={s.calm}>Nothing on right now.</Text>
        <Pressable style={s.textBtn} onPress={() => navigate({ name: "home" })}>
          <Text style={s.textLabel}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <View style={s.head}>
        <Text style={s.title}>{proposal.title}</Text>
        <Text style={s.timer}>{formatLeft(msLeft)}</Text>
      </View>

      <View style={s.plan}>
        <Text style={s.planTitle}>{proposal.place}</Text>
        <Text style={s.planMeta}>{proposal.detail}</Text>
      </View>

      <View style={s.spacer} />

      <Pressable
        style={[s.btn, s.primary, busy && s.dim]}
        disabled={busy}
        onPress={() => answer("yes")}
      >
        <Text style={s.primaryLabel}>I'm in</Text>
      </Pressable>
      <Pressable
        style={[s.btn, s.ghost, busy && s.dim]}
        disabled={busy}
        onPress={() => setSheet(true)}
      >
        <Text style={s.ghostLabel}>I'm in if…</Text>
      </Pressable>
      <Pressable style={s.textBtn} disabled={busy} onPress={() => answer("no")}>
        <Text style={s.textLabel}>Can't make it</Text>
      </Pressable>

      <Modal
        visible={sheet}
        transparent
        animationType="slide"
        onRequestClose={() => setSheet(false)}
      >
        <Pressable style={s.scrim} onPress={() => setSheet(false)} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.sheetTitle}>I'm in if…</Text>

          <View style={s.seg}>
            {(["all", "any"] as const).map((m) => (
              <Pressable
                key={m}
                style={[s.segOpt, mode === m && s.segOn]}
                onPress={() => setMode(m)}
              >
                <Text style={[s.segLabel, mode === m && s.segLabelOn]}>
                  {m === "all" ? "All of these" : "At least one"}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={s.people}>
            {proposal.members.map((mem: Member) => {
              const on = picked.includes(mem.id);
              return (
                <Pressable
                  key={mem.id}
                  style={[s.person, on && s.personOn]}
                  onPress={() =>
                    setPicked((p) => (on ? p.filter((x) => x !== mem.id) : [...p, mem.id]))
                  }
                >
                  <View style={[s.pav, on && s.pavOn]}>
                    <Text style={[s.pavText, on && s.pavTextOn]}>{mem.name[0]}</Text>
                  </View>
                  <Text style={s.personName}>{mem.name}</Text>
                  {on && <Text style={s.check}>✓</Text>}
                </Pressable>
              );
            })}
          </View>

          <Pressable
            style={[s.btn, s.primary, s.sheetDone, (!picked.length || busy) && s.dim]}
            disabled={!picked.length || busy}
            onPress={() => {
              setSheet(false);
              answer("conditional", { mode, targetIds: picked });
            }}
          >
            <Text style={s.primaryLabel}>Done</Text>
          </Pressable>
        </View>
      </Modal>
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
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  title: { fontSize: 30, fontWeight: "600", color: colors.ink, flex: 1, marginRight: space.md },
  timer: { fontSize: 13.5, fontWeight: "600", color: colors.accentInk },
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
  ghost: { borderWidth: 1, borderColor: colors.line, backgroundColor: "transparent" },
  ghostLabel: { fontSize: 15, fontWeight: "700", color: colors.ink },
  dim: { opacity: 0.4 },
  textBtn: { paddingVertical: 12, alignItems: "center", marginTop: space.xs },
  textLabel: { fontSize: 15, fontWeight: "600", color: colors.muted },
  scrim: { flex: 1, backgroundColor: "rgba(22,30,25,0.42)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: 22,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#E2E5DD",
    alignSelf: "center",
    marginBottom: 18,
  },
  sheetTitle: { fontSize: 21, fontWeight: "700", color: colors.ink, marginBottom: 14 },
  sheetDone: { marginTop: space.lg },
  seg: {
    flexDirection: "row",
    backgroundColor: "#EEF0EA",
    borderRadius: radius.md,
    padding: 4,
    marginBottom: 18,
  },
  segOpt: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  segOn: { backgroundColor: colors.surface },
  segLabel: { fontSize: 13.5, fontWeight: "600", color: colors.muted },
  segLabelOn: { color: colors.ink },
  people: { gap: 9 },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 11,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
  },
  personOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pav: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  pavOn: { backgroundColor: colors.accent },
  pavText: { fontSize: 12, fontWeight: "700", color: colors.accentInk },
  pavTextOn: { color: "#fff" },
  personName: { fontSize: 14, fontWeight: "600", color: colors.ink },
  check: { marginLeft: "auto", fontSize: 14, fontWeight: "700", color: colors.accent },
});
