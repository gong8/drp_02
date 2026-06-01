import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { formatCountdown, formatTime } from "../lib/format";
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

function matchesFilter(e: Ev, filter: Filter): boolean {
  if (filter === "All") return true;
  if (filter === "Going") return e.myStatus === "going";
  if (filter === "Declined") return e.myStatus === "declined";
  // "Awaiting" gathers everything still wanting your input: a live moment or a collecting plan.
  return e.myStatus === "awaiting" || e.myStatus === "reacting";
}

// The right-edge chip on a list row, by phase: a live countdown, a pick nudge, or the set time.
function rowRight(e: Ev) {
  if (e.phase === "moment" && e.msLeft !== null) {
    return <DateChip small>{formatCountdown(e.msLeft)}</DateChip>;
  }
  if (e.phase === "collecting") {
    return <DateChip small>{e.iReacted ? "Picked" : `${e.candidateCount} times`}</DateChip>;
  }
  return <DateChip small>{formatTime(e.startsAt)}</DateChip>;
}

export function Dashboard({ navigation }: Props) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [hasGroups, setHasGroups] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("All");

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const fetchAll = () =>
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
      fetchAll();
      // Poll so live moments tick down and the "coming together" banner appears without a refresh.
      const poll = setInterval(fetchAll, 5000);
      return () => {
        active = false;
        clearInterval(poll);
      };
    }, []),
  );

  // A live moment still awaiting your answer is the most time-sensitive thing - surface it loudly.
  const banner = useMemo(
    () => events.find((e) => e.phase === "moment" && e.myStatus === "awaiting"),
    [events],
  );

  // Featured = the soonest plan still wanting my input (excluding whatever the banner already shows).
  const featured = useMemo(() => {
    return events
      .filter(
        (e) => e.id !== banner?.id && (e.myStatus === "awaiting" || e.myStatus === "reacting"),
      )
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];
  }, [events, banner]);

  const list = useMemo(() => {
    return events
      .filter((e) => e.id !== featured?.id && e.id !== banner?.id)
      .filter((e) => matchesFilter(e, filter))
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [events, featured, banner, filter]);

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
          <Heading title="Your meets" />

          {error && (
            <Text style={{ fontFamily: font.medium, color: ui.muted, marginBottom: 12 }}>
              Couldn't reach the server.
            </Text>
          )}

          {!error && banner && (
            <Pressable onPress={() => navigation.navigate("EventDetail", { eventId: banner.id })}>
              <HardShadow radius={ui.rButton} style={{ marginBottom: 14 }}>
                <View
                  style={{
                    backgroundColor: ui.brand,
                    borderWidth: ui.border,
                    borderColor: ui.ink,
                    borderRadius: ui.rButton,
                    padding: 13,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: font.display, fontSize: 14, color: "#fff" }}>
                      It's coming together
                    </Text>
                    <Text
                      style={{ fontFamily: font.medium, fontSize: 11, color: "#fff", marginTop: 2 }}
                    >
                      {banner.title} {"·"} lock in your answer
                    </Text>
                  </View>
                  <Text
                    style={{ fontFamily: font.mono, fontSize: 13, color: "#fff", marginLeft: 8 }}
                  >
                    {formatCountdown(banner.msLeft ?? 0)}
                  </Text>
                </View>
              </HardShadow>
            </Pressable>
          )}

          {!error &&
            (!hasGroups ? (
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
                  You need a group before you can plan a meetup. Create one or join an existing
                  group to get started.
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
                        <StickerTag
                          label={
                            featured.phase === "moment"
                              ? `Locks ${formatCountdown(featured.msLeft ?? 0)}`
                              : "Which times?"
                          }
                        />
                      </View>
                      <Text
                        style={{
                          fontFamily: font.medium,
                          fontSize: 10,
                          color: ui.muted,
                          marginTop: 2,
                        }}
                      >
                        {featured.groupName}
                        {featured.location ? ` · ${featured.location}` : ""}
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: 11,
                        }}
                      >
                        {featured.phase === "collecting" ? (
                          <>
                            <DateChip>{`${featured.candidateCount} times`}</DateChip>
                            <Text style={{ fontFamily: font.medium, fontSize: 9, color: ui.muted }}>
                              {featured.iReacted ? "You've picked your times" : "Tap to pick times"}
                            </Text>
                          </>
                        ) : (
                          <>
                            <DateChip>{formatTime(featured.startsAt)}</DateChip>
                            <Text style={{ fontFamily: font.medium, fontSize: 9, color: ui.muted }}>
                              Who's in shows after the timer
                            </Text>
                          </>
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
                      {e.phase === "cleared" && e.goingCount ? (
                        <View style={{ flexDirection: "row", alignItems: "center", marginLeft: 6 }}>
                          {e.goingPreview.map((p, j) => (
                            <View key={p.uid} style={{ marginLeft: j === 0 ? 0 : -6 }}>
                              <Avatar initial={p.initial} color={p.color} size={16} />
                            </View>
                          ))}
                        </View>
                      ) : null}
                      <View style={{ marginLeft: "auto" }}>{rowRight(e)}</View>
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
            ))}
        </ScrollView>

        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 }}>
          {hasGroups && !error ? (
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
