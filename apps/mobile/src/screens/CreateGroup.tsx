import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import type { GroupsStackParams } from "../../App";
import { ERR_SAVE } from "../lib/copy";
import { trpc } from "../lib/trpc";
import { ui } from "../theme";
import { AppText, Button, Field, ScreenHeader, ScreenScroll } from "../ui";

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
    <ScreenScroll
      header={<ScreenHeader title="New group" onBack={() => navigation.goBack()} />}
      avoidKeyboard
    >
      {error && (
        <AppText variant="caption" style={{ color: ui.brand, marginBottom: 10 }}>
          {ERR_SAVE}
        </AppText>
      )}
      <Field label="Group name" value={name} onChangeText={setName} placeholder="The Boys" />
      <AppText variant="caption" style={{ marginTop: 8 }}>
        You can add members once it's created.
      </AppText>
      <Button
        label="Create group"
        variant="primary"
        disabled={name.trim() === "" || busy}
        onPress={create}
        style={{ marginTop: 20 }}
      />
    </ScreenScroll>
  );
}
