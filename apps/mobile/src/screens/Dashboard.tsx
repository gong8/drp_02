import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { AccountAvatar } from "../components/AccountAvatar";
import { countdown, formatTime } from "../lib/format";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import {
  Avatar,
  Card,
  DateChip,
  HardShadow,
  Heading,
  ScreenBackground,
  StatusCheck,
  StickerTag,
  Tabs,
} from "../ui";

// Large, themed primary action that anchors the bottom of the dashboard.
function BigButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <HardShadow radius={ui.rButton}>
      <Pressable
        onPress={onPress}
        style={{
          backgroundColor: ui.brand,
          borderWidth: ui.border,
          borderColor: ui.ink,
          borderRadius: ui.rButton,
          paddingVertical: 18,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontFamily: font.display, fontSize: 17, color: "#fff" }}>{label}</Text>
      </Pressable>
    </HardShadow>
  );
}

type Ev = Awaited<ReturnType<typeof trpc.events.mine.query>>[number];
type Props = NativeStackScreenProps<MeetupsStackParams, "Dashboard">;
const FILTERS = ["All", "Going", "Awaiting", "Declined"] as const;
type Filter = (typeof FILTERS)[number];

export function Dashboard({ navigation }: Props) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [hasGroups, setHasGroups] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("All");

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([trpc.events.mine.query(), trpc.groups.mine.query()])
        .then(([e, g]) => {
          if (active) {
            setEvents(e);
            setHasGroups(g.length > 0);
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

  // Featured = the soonest meet still awaiting my response.
  const featured = useMemo(() => {
    return [...events]
      .filter((e) => e.myStatus === "awaiting")
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];
  }, [events]);

  const list = useMemo(() => {
    const rest = events.filter((e) => e.id !== featured?.id);
    const matches = (e: Ev) =>
      filter === "All" ||
      (filter === "Going" && e.myStatus === "going") ||
      (filter === "Awaiting" && e.myStatus === "awaiting") ||
      (filter === "Declined" && e.myStatus === "declined");
    return rest
      .filter(matches)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [events, featured, filter]);

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
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
        >
          <Heading title="Your meets" right={<AccountAvatar />} />

          {error && (
            <Text style={{ fontFamily: font.medium, color: ui.muted, marginBottom: 12 }}>
              Couldn't reach the server.
            </Text>
          )}

          {!hasGroups ? (
            <Card>
              <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink }}>
                No groups yet
              </Text>
              <Text
                style={{
                  fontFamily: font.medium,
                  fontSize: 12,
                  color: ui.muted,
                  marginTop: 6,
                  lineHeight: 18,
                }}
              >
                You need a group before you can plan a meetup. Create one or join an existing group
                to get started.
              </Text>
            </Card>
          ) : (
            <>
              {featured && (
                <Pressable
                  onPress={() => navigation.navigate("EventDetail", { eventId: featured.id })}
                >
                  <Card style={{ marginBottom: 16 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ fontFamily: font.display, fontSize: 18, color: ui.ink }}>
                        {featured.title}
                      </Text>
                      <StickerTag label={`RSVP ${countdown(featured.respondByAt)}`} />
                    </View>
                    <Text
                      style={{
                        fontFamily: font.medium,
                        fontSize: 10,
                        color: ui.muted,
                        marginTop: 2,
                      }}
                    >
                      {featured.groupName} {"·"} {featured.location}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: 11,
                      }}
                    >
                      <DateChip>{formatTime(featured.startsAt)}</DateChip>
                      {featured.goingCount === null ? (
                        <Text style={{ fontFamily: font.medium, fontSize: 9, color: ui.muted }}>
                          Who's in shows after the timer
                        </Text>
                      ) : (
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          {featured.goingPreview.map((p, i) => (
                            <View key={p.uid} style={{ marginLeft: i === 0 ? 0 : -6 }}>
                              <Avatar initial={p.initial} color={p.color} size={18} />
                            </View>
                          ))}
                          <Text
                            style={{
                              fontFamily: font.bold,
                              fontSize: 9,
                              color: ui.muted,
                              marginLeft: 5,
                            }}
                          >
                            +{featured.goingCount} going
                          </Text>
                        </View>
                      )}
                    </View>
                  </Card>
                </Pressable>
              )}

              <Tabs options={FILTERS} value={filter} onChange={setFilter} />

              <Card padding={0}>
                {list.map((e, i) => (
                  <Pressable
                    key={e.id}
                    onPress={() => navigation.navigate("EventDetail", { eventId: e.id })}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 9,
                      padding: 11,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: ui.hairline,
                    }}
                  >
                    <StatusCheck status={e.myStatus} />
                    <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>
                      {e.title}
                    </Text>
                    <View style={{ marginLeft: "auto" }}>
                      <DateChip small>{formatTime(e.startsAt)}</DateChip>
                    </View>
                  </Pressable>
                ))}
                {list.length === 0 && (
                  <Text
                    style={{
                      fontFamily: font.medium,
                      fontSize: 12,
                      color: ui.muted,
                      padding: 14,
                      textAlign: "center",
                    }}
                  >
                    Nothing here yet.
                  </Text>
                )}
              </Card>
            </>
          )}
        </ScrollView>

        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 }}>
          {hasGroups ? (
            <BigButton
              label="Suggest a meetup"
              onPress={() => navigation.navigate("CreateEvent")}
            />
          ) : (
            <BigButton
              label="Create a group"
              onPress={() => navigation.getParent()?.navigate("Groups", { screen: "CreateGroup" })}
            />
          )}
        </View>
      </View>
    </ScreenBackground>
  );
}
