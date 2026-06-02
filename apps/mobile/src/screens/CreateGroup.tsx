import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import type { GroupsStackParams } from "../../App";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { BackBar, Button, Field, ScreenBackground } from "../ui";

type Props = NativeStackScreenProps<GroupsStackParams, "CreateGroup">;

export function CreateGroup({ navigation }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function create() {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    try {
      await trpc.groups.create.mutate({ name: name.trim() });
      navigation.goBack();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <ScreenBackground header={<BackBar title="New group" onBack={() => navigation.goBack()} />}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {error && (
          <Text style={{ fontFamily: font.medium, color: ui.brand, marginBottom: 10 }}>
            Something went wrong. Try again.
          </Text>
        )}
        <Field label="Group name" value={name} onChangeText={setName} placeholder="The Boys" />
        <Text style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted, marginTop: 8 }}>
          You can add members once it's created.
        </Text>
        <Button
          label="Create group"
          variant="primary"
          disabled={name.trim() === "" || busy}
          onPress={create}
          style={{ marginTop: 20 }}
        />
      </ScrollView>
    </ScreenBackground>
  );
}
