import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { BackBar, Button, Card, Chip, Field, ScreenBackground } from "../ui";

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
      <ScreenBackground>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={ui.ink} />
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <BackBar title="Suggest a meet" onBack={() => navigation.goBack()} />
        {error && <Text style={{ fontFamily: font.medium, color: ui.brand, marginBottom: 10 }}>Something went wrong. Try again.</Text>}

        <Text style={{ fontFamily: font.bold, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: ui.ink, marginBottom: 6 }}>Group</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 6 }}>
          {groups.map((g) => (
            <Chip key={g.id} label={g.name} selected={groupId === g.id} onPress={() => setGroupId(g.id)} />
          ))}
        </View>

        <Field label="Title" value={title} onChangeText={setTitle} placeholder="Bowling" style={{ marginTop: 8 }} />
        <Field label="Location" value={location} onChangeText={setLocation} placeholder="TenPin Bexleyheath" style={{ marginTop: 12 }} />
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <Field label="Date" value={date} onChangeText={setDate} placeholder="2026-06-05" style={{ flex: 1 }} />
          <Field label="Time" value={time} onChangeText={setTime} placeholder="16:00" style={{ flex: 1 }} />
        </View>

        <Button label="Create" variant="primary" disabled={!ready || busy} onPress={create} style={{ marginTop: 22 }} />
      </ScrollView>
    </ScreenBackground>
  );
}
