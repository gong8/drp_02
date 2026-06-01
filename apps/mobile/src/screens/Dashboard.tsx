import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { countdown, formatTime } from "../lib/format";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import {
  Avatar,
  Card,
  DateChip,
  Heading,
  ScreenBackground,
  StatusCheck,
  StickerTag,
  Tabs,
} from "../ui";

type Ev = Awaited<ReturnType<typeof trpc.events.mine.query>>[number];
type Props = NativeStackScreenProps<MeetupsStackParams, "Dashboard">;
const FILTERS = ["All", "Going", "Awaiting"] as const;
type Filter = (typeof FILTERS)[number];

export function Dashboard({ navigation }: Props) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("All");

  useFocusEffect(
    useCallback(() => {
      let active = true;
      trpc.events.mine
        .query()
        .then((e) => active && setEvents(e))
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
      filter === "All" || (filter === "Going" ? e.myStatus === "going" : e.myStatus === "awaiting");
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
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Heading
          overline={`${events.length} this week`}
          title="Your meets"
          right={<Avatar initial="A" color={ui.muted} size={28} />}
        />

        {error && (
          <Text style={{ fontFamily: font.medium, color: ui.muted, marginBottom: 12 }}>
            Couldn't reach the server.
          </Text>
        )}

        {featured && (
          <Pressable onPress={() => navigation.navigate("EventDetail", { eventId: featured.id })}>
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
                style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted, marginTop: 2 }}
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
                      <View
                        key={`${p.initial}-${p.color}`}
                        style={{ marginLeft: i === 0 ? 0 : -6 }}
                      >
                        <Avatar initial={p.initial} color={p.color} size={18} />
                      </View>
                    ))}
                    <Text
                      style={{ fontFamily: font.bold, fontSize: 9, color: ui.muted, marginLeft: 5 }}
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
          <Pressable
            onPress={() => navigation.navigate("CreateEvent")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 11,
              borderBottomWidth: 1,
              borderBottomColor: ui.ink,
              borderStyle: "dashed",
            }}
          >
            <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted }}>
              Suggest a meet...
            </Text>
            <View
              style={{
                marginLeft: "auto",
                width: 24,
                height: 24,
                borderRadius: 7,
                borderWidth: 1,
                borderColor: ui.ink,
                backgroundColor: ui.brand,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{ fontFamily: font.display, fontSize: 14, color: "#fff", marginTop: -1 }}
              >
                +
              </Text>
            </View>
          </Pressable>
          {list.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => navigation.navigate("EventDetail", { eventId: e.id })}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 9,
                padding: 11,
                borderTopWidth: 1,
                borderTopColor: ui.hairline,
              }}
            >
              <StatusCheck status={e.myStatus} />
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{e.title}</Text>
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
      </ScrollView>
    </ScreenBackground>
  );
}
