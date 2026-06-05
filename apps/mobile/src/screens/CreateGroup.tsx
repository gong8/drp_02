import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import type { GroupsStackParams } from "../../App";
import { ERR_SAVE, LABEL_GROUP_NAME, TITLE_NEW_GROUP } from "../lib/copy";
import { trpc } from "../lib/trpc";
import { AppText, Button, Field, FormError, ScreenHeader, ScreenScroll } from "../ui";

type Props = NativeStackScreenProps<GroupsStackParams, "CreateGroup">;

export function CreateGroup({ navigation }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const trimmed = name.trim();
  const canCreate = trimmed !== "" && !busy;

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    try {
      await trpc.groups.create.mutate({ name: trimmed });
      navigation.goBack();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <ScreenScroll
      header={<ScreenHeader title={TITLE_NEW_GROUP} onBack={() => navigation.goBack()} />}
      avoidKeyboard
    >
      {error && <FormError>{ERR_SAVE}</FormError>}
      <Field label={LABEL_GROUP_NAME} value={name} onChangeText={setName} placeholder="The Boys" />
      <AppText variant="caption" style={{ marginTop: 8 }}>
        You can add members once it's created.
      </AppText>
      <Button
        label="Create group"
        variant="primary"
        disabled={!canCreate}
        onPress={create}
        style={{ marginTop: 20 }}
      />
    </ScreenScroll>
  );
}
