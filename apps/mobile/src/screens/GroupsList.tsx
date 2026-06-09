import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import type { GroupsStackParams } from "../../App";
import { AccountHeaderButton } from "../components/AccountHeaderButton";
import {
  ACTION_CREATE_GROUP,
  ACTION_JOIN,
  ACTION_JOIN_WITH_CODE,
  ERR_NETWORK,
  LABEL_JOIN_CODE,
  ONBOARD_NO_GROUPS_BODY,
  ONBOARD_NO_GROUPS_TITLE,
  TITLE_NEW_GROUP,
} from "../lib/copy";
import { colorFor, initials } from "../lib/format";
import { CODE_LENGTH, normalizeCode } from "../lib/invite";
import type { RouterOutputs } from "../lib/trpc";
import { trpc } from "../lib/trpc";
import { useFetchOnFocus } from "../lib/useFetchOnFocus";
import { font, ui } from "../theme";
import {
  AppText,
  Avatar,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Field,
  ScreenHeader,
  ScreenLoading,
  ScreenScroll,
  Section,
} from "../ui";

type Group = RouterOutputs["groups"]["mine"][number];
type Props = NativeStackScreenProps<GroupsStackParams, "GroupsList">;

export function GroupsList({ navigation }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [codeDraft, setCodeDraft] = useState("");

  useFetchOnFocus(
    useCallback(() => {
      trpc.groups.mine
        .query()
        .then((g) => {
          setGroups(g);
          setError(false);
        })
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    }, []),
  );

  if (loading) return <ScreenLoading />;

  const code = normalizeCode(codeDraft);
  function submitJoin() {
    setJoinOpen(false);
    navigation.navigate("JoinGroup", { code });
    setCodeDraft("");
  }

  // The single zero-group onboarding state: only shown when the fetch actually returned no groups (not
  // when it merely failed - we never tell a user "no groups" over a network error).
  const showOnboard = !error && groups.length === 0;

  const header = (
    <ScreenHeader
      title="Your groups"
      right={<AccountHeaderButton onPress={() => navigation.navigate("Account")} />}
    />
  );

  return (
    <ScreenScroll header={header}>
      {error && <EmptyState>{ERR_NETWORK}</EmptyState>}

      {groups.map((g) => (
        <Card
          key={g.id}
          onPress={() => navigation.navigate("GroupDetail", { groupId: g.id })}
          style={{ marginBottom: 12 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
            <Avatar initial={initials(g.name)} color={colorFor(g.id)} />
            <View>
              <AppText variant="cardTitle">{g.name}</AppText>
              <AppText variant="caption" style={{ marginTop: 1 }}>
                {g.memberCount} members
              </AppText>
            </View>
            <Text
              style={{ marginLeft: "auto", fontFamily: font.display, fontSize: 18, color: ui.ink }}
            >
              {"›"}
            </Text>
          </View>
        </Card>
      ))}

      {showOnboard ? (
        <Card>
          <AppText variant="title">{ONBOARD_NO_GROUPS_TITLE}</AppText>
          <AppText variant="captionPara" style={{ marginTop: 6 }}>
            {ONBOARD_NO_GROUPS_BODY}
          </AppText>
          <Button
            label={ACTION_CREATE_GROUP}
            variant="primary"
            onPress={() => navigation.navigate("CreateGroup")}
            style={{ marginTop: 14 }}
          />
          <Button
            label={ACTION_JOIN_WITH_CODE}
            variant="outline"
            onPress={() => setJoinOpen(true)}
            style={{ marginTop: 10 }}
          />
        </Card>
      ) : (
        <>
          <Button
            label={TITLE_NEW_GROUP}
            variant="primary"
            onPress={() => navigation.navigate("CreateGroup")}
            style={{ marginTop: 8 }}
          />
          <Button
            label={ACTION_JOIN_WITH_CODE}
            variant="outline"
            onPress={() => setJoinOpen(true)}
            style={{ marginTop: 12 }}
          />
        </>
      )}

      <BottomSheet visible={joinOpen} onClose={() => setJoinOpen(false)}>
        <Section title={ACTION_JOIN_WITH_CODE} size="lg" />
        <Field
          label={LABEL_JOIN_CODE}
          value={codeDraft}
          onChangeText={(t) => setCodeDraft(normalizeCode(t))}
          placeholder="ABCDEF12"
        />
        <Button
          label={ACTION_JOIN}
          variant="primary"
          disabled={code.length !== CODE_LENGTH}
          onPress={submitJoin}
          style={{ marginTop: 16 }}
        />
      </BottomSheet>
    </ScreenScroll>
  );
}
