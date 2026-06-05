import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { GroupsStackParams } from "../../App";
import { trpc } from "../lib/trpc";
import { useFetchOnFocus } from "../lib/useFetchOnFocus";
import { font, ui } from "../theme";
import {
  AppText,
  BottomSheet,
  Button,
  Card,
  DetailError,
  Field,
  FieldLabel,
  PersonRow,
  ScreenHeader,
  ScreenLoading,
  ScreenScroll,
  Section,
  TextButton,
} from "../ui";

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

  useFetchOnFocus(load);

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

  if (loading) return <ScreenLoading />;
  if (error || !data)
    return (
      <DetailError
        error={error}
        onBack={() => navigation.goBack()}
        notFoundLabel="Group not found."
      />
    );

  const renamed = nameDraft.trim() !== "" && nameDraft.trim() !== data.name;

  return (
    <ScreenScroll header={<ScreenHeader title={data.name} onBack={() => navigation.goBack()} />}>
      <Field
        label="Group name"
        value={nameDraft}
        onChangeText={setNameDraft}
        right={
          renamed ? (
            <TextButton
              label="Save"
              disabled={busy}
              onPress={() =>
                run(() => trpc.groups.rename.mutate({ id: groupId, name: nameDraft.trim() }))
              }
            />
          ) : undefined
        }
      />

      <FieldLabel style={{ marginTop: 16, marginBottom: 6 }}>
        {`Members (${data.members.length})`}
      </FieldLabel>
      <Card padding={0}>
        {data.members.map((m, i) => (
          <PersonRow
            key={m.id}
            name={m.name}
            color={m.color}
            index={i}
            avatarSize={28}
            right={
              <View style={{ marginLeft: "auto" }}>
                <TextButton
                  label="×"
                  tone="muted"
                  disabled={busy}
                  onPress={() =>
                    run(() => trpc.groups.removeMember.mutate({ groupId, userId: m.id }))
                  }
                />
              </View>
            }
          />
        ))}
      </Card>

      <Button
        label="+ Add to group"
        variant="outline"
        onPress={openAdd}
        style={{ marginTop: 16 }}
      />

      <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)}>
        <Section title="Add to group" size="lg" />
        <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
          {addable.map((u) => (
            <PersonRow
              key={u.id}
              name={u.name}
              color={u.color}
              index={0}
              divided={false}
              padding={9}
              onPress={async () => {
                await run(() => trpc.groups.addMember.mutate({ groupId, userId: u.id }));
                setAddable((prev) => prev.filter((x) => x.id !== u.id));
              }}
              right={
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
              }
            />
          ))}
          {addable.length === 0 && <AppText variant="caption">Everyone's already in.</AppText>}
        </ScrollView>
      </BottomSheet>
    </ScreenScroll>
  );
}
