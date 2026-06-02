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

// The muted right-side line in a card footer - a nudge or a quiet note.
function Hint({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: font.medium,
        fontSize: 10,
        color: ui.muted,
        flexShrink: 1,
        textAlign: "right",
        marginLeft: 12,
      }}
    >
      {children}
    </Text>
  );
}

// The footer's left datum + right people/nudge, by phase - the same language as the featured card:
// collecting shows the menu size + a pick nudge; cleared shows the set time + the IN crowd; a live
// moment shows the time + when the answer reveals.
function CardFooter({ e }: { e: Ev }) {
  if (e.phase === "collecting") {
    return (
      <>
        <DateChip>{`${e.candidateCount} times`}</DateChip>
        <Hint>{e.iReacted ? "You've picked your times" : "Tap to pick times"}</Hint>
      </>
    );
  }
  if (e.phase === "cleared") {
    return (
      <>
        <DateChip>{formatTime(e.startsAt)}</DateChip>
        {e.goingCount ? (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {e.goingPreview.map((p, j) => (
              <View key={p.uid} style={{ marginLeft: j === 0 ? 0 : -7 }}>
                <Avatar initial={p.initial} color={p.color} size={22} />
              </View>
            ))}
            <Text style={{ fontFamily: font.bold, fontSize: 11, color: ui.ink, marginLeft: 8 }}>
              {e.goingCount} going
            </Text>
          </View>
        ) : (
          <Hint>{e.myStatus === "declined" ? "You're out" : "Didn't come together"}</Hint>
        )}
      </>
    );
  }
  // moment - the blind countdown
  return (
    <>
      <DateChip>{formatTime(e.startsAt)}</DateChip>
      <Hint>Who's in shows after the timer</Hint>
    </>
  );
}

// Status lives in the sticker, in the system's own idiom (solid, ink-shadowed, tilted) - not a
// pastel badge. Pink while a plan still wants you (pick times / live lock), green once you're
// locked in. A settled plan you're not in wears nothing; absence is the signal.
function cardSticker(e: Ev) {
  if (e.phase === "collecting") return <StickerTag label="Which times?" />;
  if (e.phase === "moment") return <StickerTag label={`Locks ${formatCountdown(e.msLeft ?? 0)}`} />;
  if (e.phase === "cleared" && e.myStatus === "going")
    return <StickerTag label="You're in" color={ui.going} />;
  return null;
}

// One plan as a card, built from the same parts as the featured card so the screen reads as a set:
// title + sticker, the group/place line, then the phase footer. Declined plans sit back, dimmed.
function MeetCard({ e, onPress, last }: { e: Ev; onPress: () => void; last?: boolean }) {
  return (
    <Pressable onPress={onPress}>
      <Card
        padding={14}
        style={{ marginBottom: last ? 0 : 11, opacity: e.myStatus === "declined" ? 0.6 : 1 }}
      >
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <Text
            style={{
              fontFamily: font.display,
              fontSize: 16,
              color: ui.ink,
              flexShrink: 1,
              marginRight: 8,
            }}
          >
            {e.title}
          </Text>
          {cardSticker(e)}
        </View>
        <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 2 }}>
          {e.groupName}
          {e.location ? ` · ${e.location}` : ""}
        </Text>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 12,
          }}
        >
          <CardFooter e={e} />
        </View>
      </Card>
    </Pressable>
  );
}

// The white, ink-bordered count chip that sits on the pink action tray. Fixed circle + killed font
// padding so the number lands dead-centre on every platform.
function CountBadge({ n }: { n: number }) {
  return (
    <View
      style={{
        minWidth: 26,
        height: 26,
        borderRadius: 13,
        paddingHorizontal: 6,
        backgroundColor: ui.surface,
        borderWidth: ui.border,
        borderColor: ui.ink,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontFamily: font.mono,
          fontSize: 12,
          lineHeight: 14,
          color: ui.ink,
          textAlign: "center",
          includeFontPadding: false,
        }}
      >
        {n}
      </Text>
    </View>
  );
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
      // Poll so live moments tick down and newly-urgent plans surface without a manual refresh.
      const poll = setInterval(fetchAll, 5000);
      return () => {
        active = false;
        clearInterval(poll);
      };
    }, []),
  );

  // Everything waiting on ME to act now: a live moment I haven't answered, or a menu of times I
  // haven't picked from. These lift to the top; live moments (ticking) lead, soonest deadline first.
  const actionItems = useMemo(() => {
    return events
      .filter(
        (e) =>
          (e.phase === "moment" && e.myStatus === "awaiting") ||
          (e.phase === "collecting" && !e.iReacted),
      )
      .sort((a, b) => {
        const am = a.phase === "moment";
        const bm = b.phase === "moment";
        if (am !== bm) return am ? -1 : 1;
        if (am && bm) return (a.msLeft ?? 0) - (b.msLeft ?? 0);
        return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
      });
  }, [events]);

  const actionIds = useMemo(() => new Set(actionItems.map((e) => e.id)), [actionItems]);

  // The browsable archive below: everything not awaiting my action, segmented by the status tabs.
  const list = useMemo(() => {
    return events
      .filter((e) => !actionIds.has(e.id))
      .filter((e) => matchesFilter(e, filter))
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [events, actionIds, filter]);

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
                {actionItems.length > 0 && (
                  <HardShadow radius={ui.rCard} style={{ marginBottom: 20 }}>
                    <View
                      style={{
                        backgroundColor: ui.brand,
                        borderWidth: ui.border,
                        borderColor: ui.ink,
                        borderRadius: ui.rCard,
                        padding: 12,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 12,
                          paddingHorizontal: 2,
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: font.black,
                            fontSize: 16,
                            letterSpacing: 0.3,
                            textTransform: "uppercase",
                            color: "#fff",
                          }}
                        >
                          Action required
                        </Text>
                        <CountBadge n={actionItems.length} />
                      </View>

                      {actionItems.map((e, i) => (
                        <MeetCard
                          key={e.id}
                          e={e}
                          last={i === actionItems.length - 1}
                          onPress={() => navigation.navigate("EventDetail", { eventId: e.id })}
                        />
                      ))}
                    </View>
                  </HardShadow>
                )}

                <Tabs options={FILTERS} value={filter} onChange={setFilter} />

                {list.map((e) => (
                  <MeetCard
                    key={e.id}
                    e={e}
                    onPress={() => navigation.navigate("EventDetail", { eventId: e.id })}
                  />
                ))}
                {list.length === 0 && (
                  <Card>
                    <Text
                      style={{
                        fontFamily: font.medium,
                        fontSize: 12,
                        color: ui.muted,
                        textAlign: "center",
                        paddingVertical: 6,
                      }}
                    >
                      Nothing here yet.
                    </Text>
                  </Card>
                )}
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
