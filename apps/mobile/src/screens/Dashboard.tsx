import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { AccountAvatar } from "../components/AccountAvatar";
import {
  candidateCountLabel,
  DIDNT_COME_TOGETHER,
  ERR_NETWORK,
  goingCountLabel,
} from "../lib/copy";
import { countdownLabel, formatSlot, HOT_MS } from "../lib/format";
import { syncReminders } from "../lib/notifications";
import {
  activeDeadline,
  type Bucket,
  compareActions,
  compareForDisplay,
  isActionRequired,
  planBucket,
} from "../lib/status";
import { trpc } from "../lib/trpc";
import { useLiveClock } from "../lib/useLiveClock";
import { font, ui } from "../theme";
import {
  AppText,
  Button,
  Card,
  Countdown,
  EmptyState,
  Pill,
  ScreenHeader,
  ScreenLoading,
  ScreenScroll,
  Segmented,
  StatusPill,
} from "../ui";

type Ev = Awaited<ReturnType<typeof trpc.events.mine.query>>[number];
type Props = NativeStackScreenProps<MeetupsStackParams, "Dashboard">;

const BUCKETS = ["going", "open", "done"] as const;
const BUCKET_LABEL: Record<Bucket, string> = { going: "Going", open: "Open", done: "Done" };
const BUCKET_COLOR: Record<Bucket, string> = { going: ui.going, open: ui.open, done: ui.muted };

// One ms-to-deadline read, from the phase's active deadline.
function deadlineMs(e: Ev, now: number): number {
  const iso = activeDeadline(e).iso;
  return iso ? Math.max(0, new Date(iso).getTime() - now) : 0;
}

// A row in the pink ACTION REQUIRED panel: the meetup + a big, loud countdown to its deadline.
function ActionRow({
  e,
  now,
  first,
  onPress,
}: {
  e: Ev;
  now: number;
  first: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: "rgba(255,255,255,0.28)",
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.display, fontSize: 15, color: ui.onInk }}>
          {e.activity || e.groupName}
        </Text>
        <Text
          style={{
            fontFamily: font.medium,
            fontSize: 10,
            color: ui.onInk,
            opacity: 0.85,
            marginTop: 1,
          }}
        >
          {e.activity ? e.groupName : ""}
        </Text>
      </View>
      <Countdown ms={deadlineMs(e, now)} label={activeDeadline(e).label} color={ui.onInk} />
    </Pressable>
  );
}

// The terse footer datum(s) for a list card, by phase. Time-left lives small here (the loud countdown
// is reserved for the action panel + detail); no "on the table", no face pile.
function CardFooter({ e, now }: { e: Ev; now: number }) {
  if (e.phase === "collecting") {
    const ms = deadlineMs(e, now);
    return (
      <>
        <AppText variant="caption">{candidateCountLabel(e.candidateCount)}</AppText>
        <AppText variant="caption" style={{ color: ms < HOT_MS ? ui.brand : ui.muted }}>
          {countdownLabel(ms)}
        </AppText>
      </>
    );
  }
  if (e.phase === "moment") {
    return (
      <>
        <Pill label={formatSlot(e.startsAt)} mono />
        <AppText variant="caption">Reveals at close</AppText>
      </>
    );
  }
  // cleared
  return (
    <>
      <Pill label={formatSlot(e.startsAt)} mono />
      <AppText variant="caption">
        {e.goingCount ? goingCountLabel(e.goingCount) : DIDNT_COME_TOGETHER}
      </AppText>
    </>
  );
}

function MeetCard({ e, now, onPress }: { e: Ev; now: number; onPress: () => void }) {
  const bucket = planBucket(e, now);
  const sub = e.activity
    ? `${e.groupName}${e.location ? ` · ${e.location}` : ""}`
    : e.location || e.groupName;
  return (
    <Card
      padding={14}
      onPress={onPress}
      style={{ marginBottom: 11, opacity: bucket === "done" ? 0.62 : 1 }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <AppText variant="title" style={{ flexShrink: 1, marginRight: 8 }}>
          {e.activity || e.groupName}
        </AppText>
        {bucket === "going" ? (
          <StatusPill label="In" color={ui.going} />
        ) : bucket === "open" ? (
          <StatusPill label="Open" color={ui.open} />
        ) : null}
      </View>
      <AppText variant="caption" style={{ marginTop: 2 }}>
        {sub}
      </AppText>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 12,
        }}
      >
        <CardFooter e={e} now={now} />
      </View>
    </Card>
  );
}

export function Dashboard({ navigation }: Props) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [hasGroups, setHasGroups] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Bucket>("going");
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
              syncReminders(e);
            }
          })
          .catch(() => active && setError(true))
          .finally(() => active && setLoading(false));
      fetchAll();
      const poll = setInterval(fetchAll, 5000);
      return () => {
        active = false;
        clearInterval(poll);
      };
    }, []),
  );

  const actionItems = useMemo(
    () => events.filter(isActionRequired).sort((a, b) => compareActions(a, b)),
    [events],
  );
  const actionIds = useMemo(() => new Set(actionItems.map((e) => e.id)), [actionItems]);

  // Everything not in the action panel, in the selected bucket, sorted live-then-history.
  const list = useMemo(
    () =>
      events
        .filter((e) => !actionIds.has(e.id) && planBucket(e, now) === filter)
        .sort((a, b) => compareForDisplay(a, b, now)),
    [events, actionIds, filter, now],
  );

  const header = (
    <ScreenHeader
      title="Your meetups"
      right={
        <Pressable onPress={() => navigation.navigate("Account")} hitSlop={8}>
          <AccountAvatar />
        </Pressable>
      }
    />
  );

  const footer = hasGroups && !error && (
    <LinearGradient
      colors={["transparent", ui.gradient[1]]}
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: ui.gutter,
        paddingTop: 34,
        paddingBottom: 18,
      }}
    >
      <Button size="lg" label="New meetup" onPress={() => navigation.navigate("CreateWizard")} />
    </LinearGradient>
  );

  if (loading) return <ScreenLoading />;

  const n = actionItems.length;

  return (
    <ScreenScroll header={header} bottomPad={hasGroups ? 104 : 24} footer={footer || undefined}>
      {error && <EmptyState>{ERR_NETWORK}</EmptyState>}

      {!error && !hasGroups && (
        <Card>
          <AppText variant="title">No groups yet</AppText>
          <AppText variant="caption" style={{ marginTop: 6, lineHeight: 18 }}>
            You need a group before you can plan a meetup. Create one to start.
          </AppText>
          <Button
            label="Create a group"
            variant="primary"
            style={{ marginTop: 14 }}
            onPress={() => navigation.getParent()?.navigate("Groups", { screen: "CreateGroup" })}
          />
        </Card>
      )}

      {!error && hasGroups && (
        <>
          {n > 0 && (
            <Card tone={ui.brand} padding={0} style={{ marginBottom: 22 }}>
              <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
                <Text
                  style={{
                    fontFamily: font.black,
                    fontSize: 13,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    color: ui.onInk,
                  }}
                >
                  {`${n} action${n === 1 ? "" : "s"} required`}
                </Text>
              </View>
              {actionItems.map((e, i) => (
                <ActionRow
                  key={e.id}
                  e={e}
                  now={now}
                  first={i === 0}
                  onPress={() => navigation.navigate("EventDetail", { eventId: e.id })}
                />
              ))}
            </Card>
          )}

          <Segmented
            options={BUCKETS}
            value={filter}
            onChange={setFilter}
            activeColor={(b) => BUCKET_COLOR[b]}
            label={(b) => BUCKET_LABEL[b]}
          />

          {list.map((e) => (
            <MeetCard
              key={e.id}
              e={e}
              now={now}
              onPress={() => navigation.navigate("EventDetail", { eventId: e.id })}
            />
          ))}
          {list.length === 0 && <EmptyState inCard>Nothing here yet.</EmptyState>}
        </>
      )}
    </ScreenScroll>
  );
}
