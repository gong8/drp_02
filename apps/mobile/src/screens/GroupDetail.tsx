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
  TextInput,
  View,
} from "react-native";
import type { GroupsStackParams } from "../../App";
import { trpc } from "../lib/trpc";
import { colors, radius, space } from "../theme";

type Detail = NonNullable<Awaited<ReturnType<typeof trpc.groups.get.query>>>;
type Addable = Awaited<ReturnType<typeof trpc.groups.addableUsers.query>>;
type Props = NativeStackScreenProps<GroupsStackParams, "GroupDetail">;

export function GroupDetail({ route }: Props) {
  const { groupId } = route.params;
  const [data, setData] = useState<Detail | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addable, setAddable] = useState<Addable>([]);

  const load = useCallback(() => {
    return trpc.groups.get
      .query({ id: groupId })
      .then((d) => {
        setData(d);
        if (d) setNameDraft(d.name);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function openAdd() {
    try {
      setAddable(await trpc.groups.addableUsers.query({ groupId }));
      setAddOpen(true);
    } catch {
      setError(true);
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
        <Text style={s.calm}>{error ? "Couldn't reach the server." : "Group not found."}</Text>
      </View>
    );
  }

  const renamed = nameDraft.trim() !== "" && nameDraft.trim() !== data.name;

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.label}>Group name</Text>
        <View style={s.nameRow}>
          <TextInput style={s.nameInput} value={nameDraft} onChangeText={setNameDraft} />
          {renamed && (
            <Pressable
              style={s.save}
              disabled={busy}
              onPress={() =>
                run(() => trpc.groups.rename.mutate({ id: groupId, name: nameDraft.trim() }))
              }
            >
              <Text style={s.saveLabel}>Save</Text>
            </Pressable>
          )}
        </View>

        <Text style={[s.label, { marginTop: space.xl }]}>Members ({data.members.length})</Text>
        <View style={s.list}>
          {data.members.map((m) => (
            <View key={m.id} style={s.memberRow}>
              <View style={[s.av, { backgroundColor: m.color }]}>
                <Text style={s.avText}>{m.name[0]}</Text>
              </View>
              <Text style={s.memberName}>{m.name}</Text>
              <Pressable
                hitSlop={10}
                disabled={busy}
                onPress={() =>
                  run(() => trpc.groups.removeMember.mutate({ groupId, userId: m.id }))
                }
              >
                <Text style={s.remove}>{"✕"}</Text>
              </Pressable>
            </View>
          ))}
        </View>

        <Pressable style={s.addBtn} onPress={openAdd}>
          <Text style={s.addLabel}>Add to group</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={addOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAddOpen(false)}
      >
        <Pressable style={s.scrim} onPress={() => setAddOpen(false)} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.sheetTitle}>Add to group</Text>
          <ScrollView style={s.sheetList} showsVerticalScrollIndicator={false}>
            {addable.map((u) => (
              <Pressable
                key={u.id}
                style={s.memberRow}
                disabled={busy}
                onPress={async () => {
                  await run(() => trpc.groups.addMember.mutate({ groupId, userId: u.id }));
                  setAddable((prev) => prev.filter((x) => x.id !== u.id));
                }}
              >
                <View style={[s.av, { backgroundColor: u.color }]}>
                  <Text style={s.avText}>{u.name[0]}</Text>
                </View>
                <Text style={s.memberName}>{u.name}</Text>
                <Text style={s.add}>＋</Text>
              </Pressable>
            ))}
            {addable.length === 0 && <Text style={s.calm}>Everyone's already in.</Text>}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 24 },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  calm: { fontSize: 15, color: colors.muted, textAlign: "center" },
  label: { fontSize: 13.5, fontWeight: "600", color: colors.muted, marginBottom: 6 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  nameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
  },
  save: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  saveLabel: { fontSize: 14, fontWeight: "700", color: "#fff" },
  list: { gap: 9 },
  memberRow: {
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
  memberName: { fontSize: 14, fontWeight: "600", color: colors.ink, flex: 1 },
  remove: { fontSize: 15, fontWeight: "700", color: colors.muted },
  add: { fontSize: 18, fontWeight: "700", color: colors.accent },
  addBtn: {
    marginTop: space.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
  },
  addLabel: { fontSize: 15, fontWeight: "700", color: colors.accentInk },
  scrim: { flex: 1, backgroundColor: "rgba(22,30,25,0.42)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: 22,
    maxHeight: "70%",
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
  sheetList: { gap: 9 },
});
