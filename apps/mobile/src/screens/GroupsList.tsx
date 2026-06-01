import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { GroupsStackParams } from "../../App";
import { AccountAvatar } from "../components/AccountAvatar";
import { colorFor, initials } from "../lib/format";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { Avatar, Button, Card, Heading, ScreenBackground } from "../ui";

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
        .then((g) => active && setGroups(g))
        .catch(() => active && setError(true))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, []),
  );

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
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Heading
          overline={`${groups.length} groups`}
          title="Your groups"
          right={<AccountAvatar />}
        />
        {error && (
          <Text style={{ fontFamily: font.medium, color: ui.muted, marginBottom: 12 }}>
            Couldn't reach the server.
          </Text>
        )}

        {groups.map((g) => (
          <Pressable
            key={g.id}
            onPress={() => navigation.navigate("GroupDetail", { groupId: g.id })}
          >
            <Card style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
                <Avatar initial={initials(g.name)} color={colorFor(g.id)} />
                <View>
                  <Text style={{ fontFamily: font.display, fontSize: 15, color: ui.ink }}>
                    {g.name}
                  </Text>
                  <Text
                    style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted, marginTop: 1 }}
                  >
                    {g.memberCount} members
                  </Text>
                </View>
                <Text
                  style={{
                    marginLeft: "auto",
                    fontFamily: font.display,
                    fontSize: 18,
                    color: ui.ink,
                  }}
                >
                  {"›"}
                </Text>
              </View>
            </Card>
          </Pressable>
        ))}
        {groups.length === 0 && (
          <Text
            style={{
              fontFamily: font.medium,
              fontSize: 12,
              color: ui.muted,
              textAlign: "center",
              marginTop: 16,
            }}
          >
            No groups yet.
          </Text>
        )}

        <Button
          label="New group"
          variant="primary"
          onPress={() => navigation.navigate("CreateGroup")}
          style={{ marginTop: 8 }}
        />
      </ScrollView>
    </ScreenBackground>
  );
}
