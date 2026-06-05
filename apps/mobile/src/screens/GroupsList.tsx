import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { GroupsStackParams } from "../../App";
import { AccountAvatar } from "../components/AccountAvatar";
import { ERR_NETWORK } from "../lib/copy";
import { colorFor, initials } from "../lib/format";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import {
  AppText,
  Avatar,
  Button,
  Card,
  EmptyState,
  ScreenHeader,
  ScreenLoading,
  ScreenScroll,
} from "../ui";

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
        .then((g) => {
          if (active) {
            setGroups(g);
            setError(false);
          }
        })
        .catch(() => active && setError(true))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, []),
  );

  if (loading) return <ScreenLoading />;

  const header = (
    <ScreenHeader
      title="Your groups"
      right={
        <Pressable onPress={() => navigation.navigate("Account")} hitSlop={8}>
          <AccountAvatar />
        </Pressable>
      }
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
              <Text style={{ fontFamily: font.display, fontSize: 15, color: ui.ink }}>
                {g.name}
              </Text>
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
      {groups.length === 0 && <EmptyState>No groups yet.</EmptyState>}

      <Button
        label="New group"
        variant="primary"
        onPress={() => navigation.navigate("CreateGroup")}
        style={{ marginTop: 8 }}
      />
    </ScreenScroll>
  );
}
