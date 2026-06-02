import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { formatCountdown, formatSlot } from "../lib/format";
import { syncReminders } from "../lib/notifications";
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
        <Hint>
          {e.myStatus === "declined"
            ? "You're sitting this out"
            : e.iReacted
              ? "You've picked your times"
              : "Tap to pick times"}
        </Hint>
      </>
    );
  }
  if (e.phase === "cleared") {
    return (
      <>
        <DateChip>{formatSlot(e.startsAt)}</DateChip>
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
      <DateChip>{formatSlot(e.startsAt)}</DateChip>
      <Hint>Who's in shows after the timer</Hint>
    </>
  );
}

// Status lives in the sticker, in the system's own idiom (solid, ink-shadowed, tilted) - not a
// pastel badge. Pink while a plan still wants you (pick times / live lock), green once you're
// locked in. A settled plan you're not in wears nothing; absence is the signal.
function cardSticker(e: Ev) {
  if (e.phase === "collecting")
    return e.myStatus === "declined" ? null : <StickerTag label="Which times?" />;
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

// What the user must do, by phase.
function actionVerb(e: Ev): string {
  return e.phase === "moment" ? "Say if you're in" : "Pick your times";
}

// Live ms to the relevant deadline (the lock for collecting, the close for a moment).
function deadlineMs(e: Ev, now: number): number {
  const iso = e.phase === "moment" ? e.momentEndsAt : e.lockAt;
  return iso ? Math.max(0, new Date(iso).getTime() - now) : 0;
}

// Fraction of the window still left (1 = just opened, 0 = at the deadline) for the drain bar.
function remainingFrac(e: Ev, now: number): number {
  let start: number | null = null;
  let end: number | null = null;
  if (e.phase === "moment" && e.momentEndsAt) {
    end = new Date(e.momentEndsAt).getTime();
    start = e.momentStartsAt ? new Date(e.momentStartsAt).getTime() : end - 3_600_000;
  } else if (e.phase === "collecting" && e.lockAt) {
    end = new Date(e.lockAt).getTime();
    start = new Date(e.createdAt).getTime();
  }
  if (start === null || end === null || end <= start) return 1;
  return Math.max(0, Math.min(1, (end - now) / (end - start)));
}

// An Action Required card: title + group, the explicit action + a live deadline, a draining bar
// (green -> pink as time runs low), then the specific time (moment) or option count (collecting).
function ActionCard({
  e,
  now,
  onPress,
  last,
}: {
  e: Ev;
  now: number;
  onPress: () => void;
  last?: boolean;
}) {
  const frac = remainingFrac(e, now);
  const hot = frac < 0.25;
  const spec = e.phase === "moment" ? formatSlot(e.startsAt) : `${e.candidateCount} options`;
  return (
    <Pressable onPress={onPress}>
      <Card padding={12} style={{ marginBottom: last ? 0 : 10 }}>
        <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink }}>{e.title}</Text>
        <Text style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted, marginTop: 1 }}>
          {e.groupName}
        </Text>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 8,
            marginTop: 11,
            marginBottom: 7,
          }}
        >
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.brand, flexShrink: 1 }}>
            {`${actionVerb(e)} ›`}
          </Text>
          <Text style={{ fontFamily: font.mono, fontSize: 11, color: hot ? ui.brand : ui.ink }}>
            {`${e.phase === "moment" ? "closes" : "locks"} ${formatCountdown(deadlineMs(e, now))}`}
          </Text>
        </View>
        <View
          style={{
            height: 12,
            borderWidth: ui.border,
            borderColor: ui.ink,
            borderRadius: 999,
            backgroundColor: ui.surface,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: "100%",
              width: `${Math.round(frac * 100)}%`,
              backgroundColor: hot ? ui.brand : ui.going,
            }}
          />
        </View>
        <Text
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            letterSpacing: 0.5,
            color: ui.muted,
            marginTop: 8,
          }}
        >
          {spec.toUpperCase()}
        </Text>
      </Card>
    </Pressable>
  );
}

export function Dashboard({ navigation }: Props) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [hasGroups, setHasGroups] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("All");
  // Local clock so the Action Required countdowns + drain bars tick live (the poll is only every 5s).
  const [now, setNow] = useState(Date.now());

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const tick = setInterval(() => {
        if (active) setNow(Date.now());
      }, 1000);
      const fetchAll = () =>
        Promise.all([trpc.events.mine.query(), trpc.groups.mine.query()])
          .then(([e, g]) => {
            if (active) {
              setEvents(e);
              setHasGroups(g.length > 0);
              setError(false);
              // Schedule local deadline/moment reminders from the freshest payload (no-op unless
              // something reminder-relevant changed). Device-local; fine for supervised demos.
              syncReminders(e);
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
        clearInterval(tick);
      };
    }, []),
  );

  // Everything waiting on ME to act now: a live moment I haven't answered, or a menu of times I
  // haven't picked from. These lift to the top; live moments (ticking) lead, soonest deadline first.
  const actionItems = useMemo(() => {
    return events
      .filter(
        (e) =>
          // Moment: still required until you've answered at all (yes/no/conditional). Collecting:
          // until you've ticked a time (and haven't opted out). Either choice removes it; reversing
          // the choice (untick all / "Change" the answer) brings it back.
          (e.phase === "moment" && !e.iResponded) ||
          (e.phase === "collecting" && !e.iReacted && e.myStatus !== "declined"),
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
  // Plans I'm going to float to the top (quick access right after I commit); declined sink; ties
  // break by soonest.
  const list = useMemo(() => {
    const rank = (e: Ev) => (e.myStatus === "going" ? 0 : e.myStatus === "declined" ? 2 : 1);
    return events
      .filter((e) => !actionIds.has(e.id))
      .filter((e) => matchesFilter(e, filter))
      .sort(
        (a, b) =>
          rank(a) - rank(b) || new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      );
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
    <ScreenBackground header={<Heading title="Your meets" />}>
      <View style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 104 }}
          showsVerticalScrollIndicator={false}
        >
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
                        <ActionCard
                          key={e.id}
                          e={e}
                          now={now}
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

        {/* Floating CTA: a transparent-to-page-colour scrim lets the list fade out underneath it
            instead of leaving a flat dead band of gradient behind the button. */}
        <LinearGradient
          colors={["transparent", ui.gradient[1]]}
          pointerEvents="box-none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: 16,
            paddingTop: 34,
            paddingBottom: 18,
          }}
        >
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
        </LinearGradient>
      </View>
    </ScreenBackground>
  );
}
