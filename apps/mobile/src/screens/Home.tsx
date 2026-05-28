import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Navigate } from "../../App";
import { trpc } from "../lib/trpc";
import { colors, radius, space } from "../theme";

type Group = Awaited<ReturnType<typeof trpc.groups.mine.query>>[number];

// Deterministic per-group avatar colour, so each group reads as a distinct circle.
const AVATAR_COLORS = ["#5F9472", "#C9823F", "#7E6BB0", "#3F7BA8", "#B0654F"] as const;
function groupColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Home / Groups - calm by design. Groups as quiet rows; a single primary action;
// a gentle banner only when a moment is already coming together.
export function Home({ navigate }: { navigate: Navigate }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [hasMoment, setHasMoment] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([trpc.groups.mine.query(), trpc.moments.mine.query()])
      .then(([mine, moment]) => {
        setGroups(mine);
        setHasMoment(moment !== null);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

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
        <Text style={s.title}>Your Groups</Text>

        {hasMoment && (
          <Pressable style={s.banner} onPress={() => navigate({ name: "moment" })}>
            <Text style={s.bannerText}>Something's coming together →</Text>
          </Pressable>
        )}

        <View style={s.list}>
          {groups.map((g) => {
            const sug = g.activeSuggestion;
            return (
              <Pressable
                key={g.id}
                style={s.row}
                disabled={!sug}
                onPress={() => sug && navigate({ name: "availability", suggestionId: sug.id })}
              >
                <View style={s.rowMain}>
                  <View style={s.rowText}>
                    <Text style={s.rowName}>{g.name}</Text>
                    <Text style={s.rowMeta}>Members ({g.memberCount})</Text>
                  </View>
                  <View style={[s.avatar, { backgroundColor: groupColor(g.id) }]}>
                    <Text style={s.avatarText}>{initials(g.name)}</Text>
                  </View>
                </View>
                {sug && (
                  <Text style={s.rowSub}>
                    {sug.byName} suggested {sug.activity} - add your availability
                  </Text>
                )}
              </Pressable>
            );
          })}
          {groups.length === 0 && <Text style={s.calm}>No groups yet.</Text>}
        </View>
      </ScrollView>

      <View style={s.footer}>
        <Pressable style={[s.btn, s.primary]} onPress={() => navigate({ name: "suggest" })}>
          <Text style={s.primaryLabel}>Suggest a Meet</Text>
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
  row: {
    padding: 18,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  rowMain: { flexDirection: "row", alignItems: "center" },
  rowText: { flex: 1 },
  rowName: { fontSize: 17, fontWeight: "600", color: colors.ink },
  rowMeta: { fontSize: 13.5, fontWeight: "500", color: colors.muted, marginTop: 3 },
  rowSub: { fontSize: 13.5, fontWeight: "500", color: colors.accentInk, marginTop: space.sm },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: space.md,
  },
  avatarText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  footer: { paddingHorizontal: 22, paddingBottom: 28, paddingTop: space.sm },
  btn: { borderRadius: radius.lg, paddingVertical: 16, alignItems: "center" },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { fontSize: 15, fontWeight: "700", color: "#fff" },
});
