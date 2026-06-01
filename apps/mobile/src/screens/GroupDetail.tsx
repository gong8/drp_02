import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { GroupsStackParams } from "../../App";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { Avatar, BackBar, BottomSheet, Button, Card, Field, ScreenBackground } from "../ui";

type Detail = NonNullable<Awaited<ReturnType<typeof trpc.groups.get.query>>>;
type Addable = Awaited<ReturnType<typeof trpc.groups.addableUsers.query>>;
type Props = NativeStackScreenProps<GroupsStackParams, "GroupDetail">;

export function GroupDetail({ route, navigation }: Props) {
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
      <ScreenBackground>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={ui.ink} />
        </View>
      </ScreenBackground>
    );
  }
  if (error || !data) {
    return (
      <ScreenBackground>
        <View style={{ padding: 16 }}>
          <BackBar title="Back" onBack={() => navigation.goBack()} />
          <Text style={{ fontFamily: font.medium, color: ui.muted }}>
            {error ? "Couldn't reach the server." : "Group not found."}
          </Text>
        </View>
      </ScreenBackground>
    );
  }

  const renamed = nameDraft.trim() !== "" && nameDraft.trim() !== data.name;

  return (
    <ScreenBackground>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <BackBar title={data.name} onBack={() => navigation.goBack()} />

        <Field
          label="Group name"
          value={nameDraft}
          onChangeText={setNameDraft}
          right={
            renamed ? (
              <Pressable
                disabled={busy}
                onPress={() =>
                  run(() => trpc.groups.rename.mutate({ id: groupId, name: nameDraft.trim() }))
                }
              >
                <Text style={{ fontFamily: font.bold, fontSize: 12, color: ui.brand }}>Save</Text>
              </Pressable>
            ) : undefined
          }
        />

        <Text
          style={{
            fontFamily: font.bold,
            fontSize: 9,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: ui.ink,
            marginTop: 16,
            marginBottom: 6,
          }}
        >
          Members ({data.members.length})
        </Text>
        <Card padding={0}>
          {data.members.map((m, i) => (
            <View
              key={m.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                padding: 11,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: ui.hairline,
              }}
            >
              <Avatar initial={m.name.charAt(0).toUpperCase()} color={m.color} size={28} />
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{m.name}</Text>
              <Pressable
                hitSlop={10}
                disabled={busy}
                onPress={() =>
                  run(() => trpc.groups.removeMember.mutate({ groupId, userId: m.id }))
                }
                style={{ marginLeft: "auto" }}
              >
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.muted }}>{"×"}</Text>
              </Pressable>
            </View>
          ))}
        </Card>

        <Button
          label="+ Add to group"
          variant="outline"
          onPress={openAdd}
          style={{ marginTop: 16 }}
        />
      </ScrollView>

      <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)}>
        <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink, marginBottom: 10 }}>
          Add to group
        </Text>
        <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
          {addable.map((u) => (
            <Pressable
              key={u.id}
              disabled={busy}
              onPress={async () => {
                await run(() => trpc.groups.addMember.mutate({ groupId, userId: u.id }));
                setAddable((prev) => prev.filter((x) => x.id !== u.id));
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 }}
            >
              <Avatar initial={u.name.charAt(0).toUpperCase()} color={u.color} size={26} />
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{u.name}</Text>
              <Text
                style={{
                  marginLeft: "auto",
                  fontFamily: font.display,
                  fontSize: 16,
                  color: ui.brand,
                }}
              >
                +
              </Text>
            </Pressable>
          ))}
          {addable.length === 0 && (
            <Text style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted }}>
              Everyone's already in.
            </Text>
          )}
        </ScrollView>
      </BottomSheet>
    </ScreenBackground>
  );
}
