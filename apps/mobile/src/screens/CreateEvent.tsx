import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { MeetupsStackParams } from "../../App";
import { trpc } from "../lib/trpc";
import { colors, radius, space } from "../theme";

type Group = Awaited<ReturnType<typeof trpc.groups.mine.query>>[number];
type Props = NativeStackScreenProps<MeetupsStackParams, "CreateEvent">;

export function CreateEvent({ navigation }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
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

  const startsAt = date && time ? new Date(`${date}T${time}:00`) : null;
  const validWhen = startsAt !== null && !Number.isNaN(startsAt.getTime());
  const ready = !!groupId && title.trim() !== "" && location.trim() !== "" && validWhen;

  async function create() {
    if (!ready || !groupId || !startsAt || busy) return;
    setBusy(true);
    try {
      await trpc.events.create.mutate({
        groupId,
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim(),
        startsAt: startsAt.toISOString(),
        respondByAt: startsAt.toISOString(),
      });
      navigation.goBack();
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

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {error && <Text style={s.err}>Something went wrong. Try again.</Text>}

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

        <Text style={s.label}>Title</Text>
        <TextInput
          style={s.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Bowling"
          placeholderTextColor={colors.muted}
        />

        <Text style={s.label}>Description</Text>
        <TextInput
          style={[s.input, s.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="Optional"
          placeholderTextColor={colors.muted}
          multiline
        />

        <Text style={s.label}>Location</Text>
        <TextInput
          style={s.input}
          value={location}
          onChangeText={setLocation}
          placeholder="TenPin Bowling, Bexleyheath"
          placeholderTextColor={colors.muted}
        />

        <View style={s.row}>
          <View style={s.col}>
            <Text style={s.label}>Date</Text>
            <TextInput
              style={s.input}
              value={date}
              onChangeText={setDate}
              placeholder="2026-05-28"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
            />
          </View>
          <View style={s.col}>
            <Text style={s.label}>Time</Text>
            <TextInput
              style={s.input}
              value={time}
              onChangeText={setTime}
              placeholder="16:00"
              placeholderTextColor={colors.muted}
            />
          </View>
        </View>
      </ScrollView>

      <View style={s.footer}>
        <Pressable
          style={[s.btn, (!ready || busy) && s.dim]}
          disabled={!ready || busy}
          onPress={create}
        >
          <Text style={s.btnLabel}>Create</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 24 },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  err: { fontSize: 14, color: "#C0573F", marginBottom: space.md },
  label: {
    fontSize: 13.5,
    fontWeight: "600",
    color: colors.muted,
    marginBottom: 6,
    marginTop: space.md,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipLabel: { fontSize: 14, fontWeight: "600", color: colors.ink },
  chipLabelOn: { color: colors.accentInk },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.ink,
  },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: space.md },
  col: { flex: 1 },
  footer: { paddingHorizontal: 22, paddingBottom: 16, paddingTop: space.sm },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 15,
    alignItems: "center",
  },
  btnLabel: { fontSize: 15, fontWeight: "700", color: "#fff" },
  dim: { opacity: 0.4 },
});
