import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { GroupsStackParams } from "../../App";
import { colorFor, initials } from "../lib/format";
import { trpc } from "../lib/trpc";
import { colors, radius, space } from "../theme";

type Group = Awaited<ReturnType<typeof trpc.groups.mine.query>>[number];
type Props = NativeStackScreenProps<GroupsStackParams, "GroupsList">;

export function GroupsList({ navigation }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      trpc.groups.mine
        .query()
        .then((g) => active && setGroups(g))
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
        {groups.map((g) => (
          <Pressable
            key={g.id}
            style={s.row}
            onPress={() => navigation.navigate("GroupDetail", { groupId: g.id })}
          >
            <View style={[s.avatar, { backgroundColor: colorFor(g.id) }]}>
              <Text style={s.avatarText}>{initials(g.name)}</Text>
            </View>
            <View style={s.rowText}>
              <Text style={s.name}>{g.name}</Text>
              <Text style={s.meta}>Members ({g.memberCount})</Text>
            </View>
            <Text style={s.caret}>{"›"}</Text>
          </Pressable>
        ))}
        {groups.length === 0 && <Text style={s.calm}>No groups yet.</Text>}
      </ScrollView>

      <View style={s.footer}>
        <Pressable style={s.btn} onPress={() => navigation.navigate("CreateGroup")}>
          <Text style={s.btnLabel}>New group</Text>
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: 14,
    marginBottom: space.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  rowText: { flex: 1, marginLeft: space.md },
  name: { fontSize: 16, fontWeight: "600", color: colors.ink },
  meta: { fontSize: 13, fontWeight: "500", color: colors.muted, marginTop: 2 },
  caret: { fontSize: 24, fontWeight: "700", color: colors.muted, marginLeft: 6 },
  footer: { paddingHorizontal: 18, paddingBottom: 16, paddingTop: space.sm },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 15,
    alignItems: "center",
  },
  btnLabel: { fontSize: 15, fontWeight: "700", color: "#fff" },
});
