import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { formatCountdown, formatSlot, formatTimeLeft } from "../lib/format";
import { syncReminders } from "../lib/notifications";
import { trpc } from "../lib/trpc";
import { useLiveClock } from "../lib/useLiveClock";
import { font, ui } from "../theme";
import {
  Avatar,
  Button,
  Card,
  DateChip,
  Heading,
  ScreenBackground,
  ScreenLoading,
  StickerTag,
  Tabs,
} from "../ui";

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

// A full-bleed banded section (edge-to-edge, ink rules top + bottom, same motif as the timer
// banners) that COVERS a whole group of cards - an uppercase heading + count over the children.
// The loud pink "Action required" band: plans that want your urgent answer.
function SectionBand({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const bg = ui.brand;
  const fg = "#fff";
  return (
    <View
      style={{
        marginHorizontal: -16,
        marginBottom: 28,
        backgroundColor: bg,
        borderColor: ui.ink,
        borderTopWidth: ui.border,
        borderBottomWidth: ui.border,
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 16,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <Text
          style={{
            fontFamily: font.black,
            fontSize: 14,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: fg,
          }}
        >
          {title}
        </Text>
        <Text style={{ fontFamily: font.bold, fontSize: 14, color: fg }}>{count}</Text>
      </View>
      {children}
    </View>
  );
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
        <DateChip>{`${e.candidateCount} on the table`}</DateChip>
        <Hint>
          {e.myStatus === "declined"
            ? "You're sitting this out"
            : e.iReacted
              ? "You've had your say"
              : "Tap to weigh in"}
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
    return e.myStatus === "declined" ? null : <StickerTag label="Weigh in" />;
  if (e.phase === "moment") return <StickerTag label={`Locks ${formatCountdown(e.msLeft ?? 0)}`} />;
  if (e.phase === "cleared" && e.myStatus === "going")
    return <StickerTag label="You're in" color={ui.going} />;
  return null;
}

// One plan as a card, built from the same parts as the featured card so the screen reads as a set:
// title + sticker, the group/place line, then the phase footer. Declined plans sit back, dimmed.
function MeetCard({ e, onPress }: { e: Ev; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card padding={14} style={{ marginBottom: 11, opacity: e.myStatus === "declined" ? 0.6 : 1 }}>
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
            {e.activity || e.groupName}
          </Text>
          {cardSticker(e)}
        </View>
        <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 2 }}>
          {e.activity ? `${e.groupName}${e.location ? ` · ${e.location}` : ""}` : e.location}
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

// What the user must do, by phase.
function actionVerb(e: Ev): string {
  return e.phase === "moment" ? "Say if you're in" : "Have your say";
}

// Live ms to the relevant deadline (the decides-by for collecting, the close for a moment).
function deadlineMs(e: Ev, now: number): number {
  const iso = e.phase === "moment" ? e.momentEndsAt : e.decidesBy;
  return iso ? Math.max(0, new Date(iso).getTime() - now) : 0;
}

// The shared body of a deadline card (the Action Required set reads as one): a title + group
// header, a nudge + prominent plain-language time-left line, and an uppercase spec line underneath.
// Callers supply the words; the layout and pixels stay identical.
function DeadlineCard({
  title,
  groupName,
  nudge,
  countdown,
  hot,
  spec,
  onPress,
  last,
}: {
  title: string;
  groupName: string;
  nudge: string;
  countdown: string;
  hot: boolean;
  spec: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable onPress={onPress}>
      <Card padding={12} style={{ marginBottom: last ? 0 : 10 }}>
        <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink }}>{title}</Text>
        <Text style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted, marginTop: 1 }}>
          {groupName}
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
            {`${nudge} ›`}
          </Text>
        </View>
        <Text
          style={{
            fontFamily: font.bold,
            fontSize: 14,
            color: hot ? ui.brand : ui.ink,
            fontVariant: ["tabular-nums"],
          }}
        >
          {countdown}
        </Text>
        <Text
          style={{
            fontFamily: font.bold,
            fontSize: 10,
            letterSpacing: 0.5,
            color: ui.muted,
            marginTop: 8,
            fontVariant: ["tabular-nums"],
          }}
        >
          {spec}
        </Text>
      </Card>
    </Pressable>
  );
}

// An Action Required card: the plan's title + group, the explicit action + a prominent plain
// time-left line, then the specific time (moment) or option count (collecting).
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
  const isMoment = e.phase === "moment";
  const msLeft = deadlineMs(e, now);
  const label = isMoment ? "RSVP closes" : "Voting closes";
  const countdown = msLeft <= 0 ? "Closing now" : `${label} in ${formatTimeLeft(msLeft)}`;
  const spec = isMoment ? formatSlot(e.startsAt) : `${e.candidateCount} on the table`;
  return (
    <DeadlineCard
      title={e.activity || e.groupName}
      groupName={e.activity ? e.groupName : ""}
      nudge={actionVerb(e)}
      countdown={countdown}
      hot={msLeft < 3600000}
      spec={spec.toUpperCase()}
      onPress={onPress}
      last={last}
    />
  );
}

export function Dashboard({ navigation }: Props) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [hasGroups, setHasGroups] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("All");
  // Local clock so the Action Required countdowns tick live (the poll is only every 5s).
  const now = useLiveClock();

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
        const aIsMoment = a.phase === "moment";
        const bIsMoment = b.phase === "moment";
        if (aIsMoment !== bIsMoment) return aIsMoment ? -1 : 1;
        if (aIsMoment && bIsMoment) return (a.msLeft ?? 0) - (b.msLeft ?? 0);
        return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
      });
  }, [events]);

  const actionIds = useMemo(() => new Set(actionItems.map((e) => e.id)), [actionItems]);

  // Below the banner: every other plan (history included), filtered by the tabs. Upcoming first
  // (soonest), then past most-recent-first - so "All" doubles as your history.
  const list = useMemo(() => {
    const nowMs = Date.now();
    const isUpcoming = (e: Ev) => new Date(e.startsAt).getTime() >= nowMs;
    return events
      .filter((e) => !actionIds.has(e.id) && matchesFilter(e, filter))
      .sort((a, b) => {
        const aUpcoming = isUpcoming(a);
        const bUpcoming = isUpcoming(b);
        if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
        const aMs = new Date(a.startsAt).getTime();
        const bMs = new Date(b.startsAt).getTime();
        return aUpcoming ? aMs - bMs : bMs - aMs;
      });
  }, [events, actionIds, filter]);

  if (loading) return <ScreenLoading />;

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
                  <SectionBand title="Action required" count={actionItems.length}>
                    {actionItems.map((e, i) => (
                      <ActionCard
                        key={e.id}
                        e={e}
                        now={now}
                        last={i === actionItems.length - 1}
                        onPress={() => navigation.navigate("EventDetail", { eventId: e.id })}
                      />
                    ))}
                  </SectionBand>
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
                        fontSize: 13,
                        color: ui.muted,
                        textAlign: "center",
                        paddingVertical: 10,
                      }}
                    >
                      Nothing here yet.
                    </Text>
                  </Card>
                )}
              </>
            ))}
        </ScrollView>

        {/* Pinned CTA: a transparent-to-page-colour scrim lets the list fade out underneath it
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
            <Button
              size="lg"
              label="New meetup"
              onPress={() => navigation.navigate("CreateWizard")}
            />
          ) : (
            <Button
              size="lg"
              label="Create a group"
              onPress={() => navigation.getParent()?.navigate("Groups", { screen: "CreateGroup" })}
            />
          )}
        </LinearGradient>
      </View>
    </ScreenBackground>
  );
}
