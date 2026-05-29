import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { countdown, dateKey, formatDate, formatTime } from "../lib/format";
import { trpc } from "../lib/trpc";
import { colors, radius, space, status } from "../theme";

type Ev = Awaited<ReturnType<typeof trpc.events.mine.query>>[number];
type Props = NativeStackScreenProps<MeetupsStackParams, "Dashboard">;

const SECTIONS = [
  {
    key: "awaiting",
    label: "Awaiting Your Response",
    color: status.pending,
    soft: status.pendingSoft,
  },
  { key: "going", label: "Going", color: status.going, soft: status.goingSoft },
  { key: "declined", label: "Declined", color: status.declined, soft: status.declinedSoft },
] as const;

function byDate(events: Ev[]): { key: string; date: string; items: Ev[] }[] {
  const sorted = [...events].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  const groups: { key: string; date: string; items: Ev[] }[] = [];
  for (const e of sorted) {
    const key = dateKey(e.startsAt);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, date: formatDate(e.startsAt), items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }
  return groups;
}

export function Dashboard({ navigation }: Props) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      trpc.events.mine
        .query()
        .then((e) => active && setEvents(e))
        .catch(() => active && setError(true))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, []),
  );

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
        {SECTIONS.map((sec) => {
          const inSec = events.filter((e) => e.myStatus === sec.key);
          if (inSec.length === 0) return null;
          return (
            <View key={sec.key} style={s.section}>
              <View style={[s.sectionHead, { backgroundColor: sec.soft }]}>
                <Text style={[s.sectionLabel, { color: sec.color }]}>{sec.label}</Text>
              </View>
              {byDate(inSec).map((d) => (
                <View key={d.key}>
                  <Text style={s.dateHead}>{d.date}</Text>
                  {d.items.map((e) => (
                    <Pressable
                      key={e.id}
                      style={s.card}
                      onPress={() => navigation.navigate("EventDetail", { eventId: e.id })}
                    >
                      <Text style={s.group}>{e.groupName}</Text>
                      <View style={s.cardRow}>
                        <Text style={s.title}>{e.title}</Text>
                        <Text style={s.time}>{formatTime(e.startsAt)}</Text>
                      </View>
                      <View style={s.cardRow}>
                        <View style={[s.pill, { backgroundColor: sec.soft }]}>
                          <Text style={[s.pillText, { color: sec.color }]}>
                            {sec.key === "awaiting"
                              ? `Pending ${countdown(e.respondByAt)}`
                              : sec.label}
                          </Text>
                        </View>
                        <Text style={s.place}>{e.location}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          );
        })}
        {events.length === 0 && <Text style={s.calm}>No meets yet. Suggest one below.</Text>}
      </ScrollView>

      <View style={s.footer}>
        <Pressable style={s.btn} onPress={() => navigation.navigate("CreateEvent")}>
          <Text style={s.btnLabel}>Suggest a Meetup</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 24 },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  calm: { fontSize: 15, color: colors.muted, textAlign: "center", marginTop: 24 },
  section: { marginBottom: space.lg },
  sectionHead: {
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: space.sm,
  },
  sectionLabel: { fontSize: 14, fontWeight: "700" },
  dateHead: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
    marginTop: space.sm,
    marginBottom: 6,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: 14,
    marginBottom: space.sm,
  },
  group: { fontSize: 12.5, fontWeight: "600", color: colors.muted, marginBottom: 4 },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  title: { fontSize: 17, fontWeight: "700", color: colors.ink },
  time: { fontSize: 15, fontWeight: "600", color: colors.accentInk },
  place: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.muted,
    flexShrink: 1,
    textAlign: "right",
    marginLeft: 8,
  },
  pill: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  pillText: { fontSize: 12, fontWeight: "700" },
  footer: { paddingHorizontal: 18, paddingBottom: 16, paddingTop: space.sm },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 15,
    alignItems: "center",
  },
  btnLabel: { fontSize: 15, fontWeight: "700", color: "#fff" },
});
