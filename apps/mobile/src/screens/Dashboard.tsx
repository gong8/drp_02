import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { Fragment, useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { AccountAvatar } from "../components/AccountAvatar";
import {
  ACTION_CREATE_GROUP,
  actionsRequiredLabel,
  candidateCountLabel,
  DIDNT_COME_TOGETHER,
  ERR_NETWORK,
  goingCountLabel,
  ONBOARD_NO_GROUPS_TITLE,
  planLabel,
  TITLE_NEW_MEETUP,
} from "../lib/copy";
import { countdownLabel, formatSlot, HOT_MS } from "../lib/format";
import { syncReminders } from "../lib/notifications";
import {
  activeDeadline,
  type Bucket,
  compareActions,
  compareForDisplay,
  compareForDisplayAll,
  deadlineMs,
  isActionRequired,
  planBucket,
} from "../lib/status";
import type { RouterOutputs } from "../lib/trpc";
import { trpc } from "../lib/trpc";
import { useLiveClock } from "../lib/useLiveClock";
import { font, ui } from "../theme";
import {
  AppText,
  Band,
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

type Meetup = RouterOutputs["events"]["mine"][number];
type Props = NativeStackScreenProps<MeetupsStackParams, "Dashboard">;

// "all" is an overview tab (the union of every bucket); it leads the row but is not the default
// landing tab - the app still opens on "going" (your confirmed commitments).
type Tab = "all" | Bucket;
const TABS = ["all", "going", "open", "done"] as const;
const TAB_LABEL: Record<Tab, string> = { all: "All", going: "Going", open: "Open", done: "Done" };
const TAB_COLOR: Record<Tab, string> = {
  all: ui.ink,
  going: ui.going,
  open: ui.open,
  done: ui.muted,
};

// A card in the pink ACTION REQUIRED band: each meetup gets its own isolated white box (so it reads
// as a distinct tappable thing against the loud band), with a brand countdown to its deadline.
function ActionRow({ e, now, onPress }: { e: Meetup; now: number; onPress: () => void }) {
  return (
    <Card padding={13} onPress={onPress} style={{ marginTop: 11 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <AppText variant="title">{planLabel(e)}</AppText>
          {e.activity ? (
            <AppText variant="caption" style={{ marginTop: 2 }}>
              {e.groupName}
            </AppText>
          ) : null}
        </View>
        <Countdown ms={deadlineMs(e, now)} label={activeDeadline(e).label} />
      </View>
    </Card>
  );
}

// The terse footer datum(s) for a list card, by phase. Time-left lives small here (the loud countdown
// is reserved for the action panel + detail); no "on the table", no face pile.
function CardFooter({ e, now }: { e: Meetup; now: number }) {
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

function MeetupCard({ e, now, onPress }: { e: Meetup; now: number; onPress: () => void }) {
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
          {planLabel(e)}
        </AppText>
        {(bucket === "going" || bucket === "open") && (
          <StatusPill label={bucket === "going" ? "In" : "Open"} color={TAB_COLOR[bucket]} />
        )}
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

// The black-weight uppercase eyebrow used by the history divider and the action-required band header.
// One in-file recipe so the two callers keep identical typography (only size/colour vary).
function Eyebrow({ size, color, children }: { size: number; color: string; children: string }) {
  return (
    <Text
      style={{
        fontFamily: font.black,
        fontSize: size,
        letterSpacing: 1,
        textTransform: "uppercase",
        color,
      }}
    >
      {children}
    </Text>
  );
}

// Rules off the history section in the "All" tab: a hairline with a small DONE label, so the agenda
// above and the finished/declined plans below read as two distinct groups.
function HistoryDivider() {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginTop: 3,
        marginBottom: 14,
      }}
    >
      <View style={{ flex: 1, height: ui.border, backgroundColor: ui.hairline }} />
      <Eyebrow size={11} color={ui.muted}>
        Done
      </Eyebrow>
      <View style={{ flex: 1, height: ui.border, backgroundColor: ui.hairline }} />
    </View>
  );
}

export function Dashboard({ navigation }: Props) {
  const [events, setEvents] = useState<Meetup[]>([]);
  const [hasGroups, setHasGroups] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("going");
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

  // Everything not in the action panel, in the selected tab. "All" shows every bucket (agenda first,
  // history below); a single bucket sorts live-then-history within itself.
  const tabItems = useMemo(() => {
    const rest = events.filter((e) => !actionIds.has(e.id));
    if (tab === "all") return rest.sort((a, b) => compareForDisplayAll(a, b, now));
    return rest
      .filter((e) => planBucket(e, now) === tab)
      .sort((a, b) => compareForDisplay(a, b, now));
  }, [events, actionIds, tab, now]);

  // In "All" the first DONE card opens the history section; mark its index so we can rule it off.
  const historyStart = useMemo(() => {
    if (tab !== "all") return -1;
    const i = tabItems.findIndex((e) => planBucket(e, now) === "done");
    return i > 0 ? i : -1;
  }, [tabItems, tab, now]);

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
      <Button
        size="lg"
        label={TITLE_NEW_MEETUP}
        onPress={() => navigation.navigate("CreateWizard")}
      />
    </LinearGradient>
  );

  if (loading) return <ScreenLoading />;

  const actionCount = actionItems.length;

  return (
    <ScreenScroll header={header} bottomPad={hasGroups ? 104 : 24} footer={footer || undefined}>
      {error && <EmptyState>{ERR_NETWORK}</EmptyState>}

      {!error && !hasGroups && (
        <Card>
          <AppText variant="title">{ONBOARD_NO_GROUPS_TITLE}</AppText>
          <AppText variant="captionPara" style={{ marginTop: 6 }}>
            You need a group before you can plan a meetup. Create one to start.
          </AppText>
          <Button
            label={ACTION_CREATE_GROUP}
            variant="primary"
            style={{ marginTop: 14 }}
            onPress={() => navigation.getParent()?.navigate("Groups", { screen: "CreateGroup" })}
          />
        </Card>
      )}

      {!error && hasGroups && (
        <>
          {actionCount > 0 && (
            <Band style={{ marginBottom: 22, paddingTop: 13, paddingBottom: 16 }}>
              <Eyebrow size={13} color={ui.onInk}>
                {actionsRequiredLabel(actionCount)}
              </Eyebrow>
              {actionItems.map((e) => (
                <ActionRow
                  key={e.id}
                  e={e}
                  now={now}
                  onPress={() => navigation.navigate("EventDetail", { eventId: e.id })}
                />
              ))}
            </Band>
          )}

          <Segmented
            options={TABS}
            value={tab}
            onChange={setTab}
            activeColor={(t) => TAB_COLOR[t]}
            label={(t) => TAB_LABEL[t]}
          />

          {tabItems.map((e, i) => (
            <Fragment key={e.id}>
              {i === historyStart && <HistoryDivider />}
              <MeetupCard
                e={e}
                now={now}
                onPress={() => navigation.navigate("EventDetail", { eventId: e.id })}
              />
            </Fragment>
          ))}
          {tabItems.length === 0 && <EmptyState inCard>Nothing here yet.</EmptyState>}
        </>
      )}
    </ScreenScroll>
  );
}
