import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MeetupsStackParams } from "../../App";
import { countdown, formatDate, formatTime } from "../lib/format";
import { trpc } from "../lib/trpc";
import { colors, radius, space, status } from "../theme";

type Detail = NonNullable<Awaited<ReturnType<typeof trpc.events.get.query>>>;
type Member = Detail["members"][number];
type Mode = "all" | "any";
type Props = NativeStackScreenProps<MeetupsStackParams, "EventDetail">;

export function EventDetail({ route, navigation }: Props) {
  const { eventId } = route.params;
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const [sheet, setSheet] = useState(false);
  const [mode, setMode] = useState<Mode>("any");
  const [picked, setPicked] = useState<string[]>([]);

  const load = useCallback(() => {
    return trpc.events.get
      .query({ id: eventId })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [eventId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function answer(
    kind: "yes" | "no" | "conditional",
    cond?: { mode: Mode; targetIds: string[] },
  ) {
    if (busy) return;
    setBusy(true);
    try {
      await trpc.events.respond.mutate(cond ? { eventId, kind, cond } : { eventId, kind });
      setEditing(false);
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
  if (error || !data) {
    return (
      <View style={s.center}>
        <Text style={s.calm}>{error ? "Couldn't reach the server." : "Event not found."}</Text>
        <Pressable style={s.textBtn} onPress={() => navigation.goBack()}>
          <Text style={s.textLabel}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const showRespond = editing || (!data.myResponse && !data.resolved);
  const statusLine =
    data.myStatus === "going"
      ? "You're going"
      : data.myStatus === "declined"
        ? "You can't make it"
        : "Awaiting your response";

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.date}>{formatDate(data.startsAt)}</Text>
        <View style={s.head}>
          <Text style={s.title}>{data.title}</Text>
          <View style={s.headRight}>
            <Text style={s.place}>{data.location}</Text>
            <Text style={s.time}>{formatTime(data.startsAt)}</Text>
          </View>
        </View>
        {data.description ? <Text style={s.desc}>{data.description}</Text> : null}
        <View style={s.rule} />

        {showRespond ? (
          <View style={s.actions}>
            {!data.resolved && (
              <Text style={s.respondBy}>Respond by {countdown(data.respondByAt)}</Text>
            )}
            <Pressable
              style={[s.box, { borderColor: status.going }, busy && s.dim]}
              disabled={busy}
              onPress={() => answer("yes")}
            >
              <Text style={[s.boxLabel, { color: status.going }]}>I will make it</Text>
            </Pressable>
            <Pressable
              style={[s.box, { borderColor: status.declined }, busy && s.dim]}
              disabled={busy}
              onPress={() => answer("no")}
            >
              <Text style={[s.boxLabel, { color: status.declined }]}>I won't make it</Text>
            </Pressable>
            <Pressable
              style={[s.box, { borderColor: status.pending }, busy && s.dim]}
              disabled={busy}
              onPress={() => {
                setPicked([]);
                setSheet(true);
              }}
            >
              <Text style={[s.boxLabel, { color: status.pending }]}>I will make it if…</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <View style={s.statusRow}>
              <Text style={s.statusText}>{statusLine}</Text>
              {!data.resolved && (
                <Pressable onPress={() => setEditing(true)}>
                  <Text style={s.change}>Change</Text>
                </Pressable>
              )}
            </View>
            <Text style={s.whoLabel}>Who's going</Text>
            <View style={s.who}>
              {data.going.map((p) => (
                <View key={p.id} style={s.whoRow}>
                  <View style={[s.av, { backgroundColor: p.color }]}>
                    <Text style={s.avText}>{p.name[0]}</Text>
                  </View>
                  <Text style={s.whoName}>{p.name}</Text>
                  <Text style={s.check}>✓</Text>
                </View>
              ))}
              {data.going.length === 0 && <Text style={s.calm}>No one's confirmed yet.</Text>}
            </View>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={sheet}
        transparent
        animationType="slide"
        onRequestClose={() => setSheet(false)}
      >
        <Pressable style={s.scrim} onPress={() => setSheet(false)} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.sheetTitle}>I will make it if…</Text>
          <Text style={s.sheetHint}>…these people are going:</Text>

          <View style={s.seg}>
            {(["any", "all"] as const).map((m) => (
              <Pressable
                key={m}
                style={[s.segOpt, mode === m && s.segOn]}
                onPress={() => setMode(m)}
              >
                <Text style={[s.segLabel, mode === m && s.segLabelOn]}>
                  {m === "all" ? "All of them" : "At least one of"}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={s.people}>
            {data.members.map((mem: Member) => {
              const on = picked.includes(mem.id);
              return (
                <Pressable
                  key={mem.id}
                  style={[s.person, on && s.personOn]}
                  onPress={() =>
                    setPicked((p) => (on ? p.filter((x) => x !== mem.id) : [...p, mem.id]))
                  }
                >
                  <Text style={s.personName}>{mem.name}</Text>
                  {on && <Text style={s.check}>✓</Text>}
                </Pressable>
              );
            })}
            {data.members.length === 0 && <Text style={s.calm}>No one else in this group.</Text>}
          </View>

          <Pressable
            style={[s.confirm, (!picked.length || busy) && s.dim]}
            disabled={!picked.length || busy}
            onPress={() => {
              setSheet(false);
              answer("conditional", { mode, targetIds: picked });
            }}
          >
            <Text style={s.confirmLabel}>Confirm</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 28 },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  calm: { fontSize: 15, color: colors.muted, textAlign: "center" },
  textBtn: { paddingVertical: 12, alignItems: "center", marginTop: space.md },
  textLabel: { fontSize: 15, fontWeight: "600", color: colors.muted },
  date: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.ink,
    textAlign: "center",
    marginBottom: space.md,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontSize: 24, fontWeight: "700", color: status.going, flex: 1, marginRight: space.md },
  headRight: { alignItems: "flex-end" },
  place: {
    fontSize: 14,
    fontWeight: "600",
    color: status.declined,
    textAlign: "right",
    maxWidth: 170,
  },
  time: { fontSize: 15, fontWeight: "700", color: status.pending, marginTop: 2 },
  desc: { fontSize: 14, fontWeight: "500", color: colors.muted, marginTop: space.sm },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: space.lg },
  actions: { gap: space.md },
  respondBy: { fontSize: 13, fontWeight: "600", color: colors.muted, textAlign: "center" },
  box: {
    borderWidth: 2,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  boxLabel: { fontSize: 16, fontWeight: "700" },
  dim: { opacity: 0.4 },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusText: { fontSize: 15, fontWeight: "700", color: colors.ink },
  change: { fontSize: 14, fontWeight: "600", color: colors.accentInk },
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
  av: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  whoName: { fontSize: 14, fontWeight: "600", color: colors.ink },
  check: { marginLeft: "auto", fontSize: 14, fontWeight: "700", color: colors.accent },
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
  sheetTitle: { fontSize: 21, fontWeight: "700", color: colors.ink, marginBottom: 4 },
  sheetHint: { fontSize: 13.5, fontWeight: "500", color: colors.muted, marginBottom: 14 },
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
    padding: 13,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
  },
  personOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  personName: { fontSize: 14, fontWeight: "600", color: colors.ink },
  confirm: {
    marginTop: space.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: "center",
  },
  confirmLabel: { fontSize: 15, fontWeight: "700", color: "#fff" },
});
