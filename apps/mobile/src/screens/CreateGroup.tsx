import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { GroupsStackParams } from "../../App";
import { trpc } from "../lib/trpc";
import { colors, radius, space } from "../theme";

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
    <View style={s.screen}>
      {error && <Text style={s.err}>Something went wrong. Try again.</Text>}
      <Text style={s.label}>Group name</Text>
      <TextInput
        style={s.input}
        value={name}
        onChangeText={setName}
        placeholder="The Boys"
        placeholderTextColor={colors.muted}
        autoFocus
      />
      <Pressable
        style={[s.btn, (name.trim() === "" || busy) && s.dim]}
        disabled={name.trim() === "" || busy}
        onPress={create}
      >
        <Text style={s.btnLabel}>Create group</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 22 },
  err: { fontSize: 14, color: "#C0573F", marginBottom: space.md },
  label: { fontSize: 13.5, fontWeight: "600", color: colors.muted, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  btn: {
    marginTop: space.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 15,
    alignItems: "center",
  },
  btnLabel: { fontSize: 15, fontWeight: "700", color: "#fff" },
  dim: { opacity: 0.4 },
});
