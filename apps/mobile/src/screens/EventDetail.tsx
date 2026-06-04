import type { PartOfDay } from "@bethere/shared";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import {
  clock12,
  dayUpper,
  formatCountdown,
  formatSlot,
  isoFrom,
  partOfDayLabel,
} from "../lib/format";
import { addCandidateHorizon } from "../lib/lock";
import { trpc } from "../lib/trpc";
import { useBusyAction } from "../lib/useBusyAction";
import { TICK_MS, useLiveClock } from "../lib/useLiveClock";
import { font, ui } from "../theme";
import {
  Avatar,
  BackBar,
  BottomSheet,
  Button,
  Card,
  DateTimePill,
  DetailError,
  Field,
  PersonRow,
  ScreenBackground,
  ScreenLoading,
  SelectCheck,
  StickerTag,
  Toggle,
} from "../ui";

type Detail = NonNullable<Awaited<ReturnType<typeof trpc.events.get.query>>>;
type Member = Detail["members"][number];
type TimeCand = Detail["timeCandidates"][number];
type ActivityCand = Detail["activityCandidates"][number];
type CondModeLabel = "At least one" | "All of them";
type Props = NativeStackScreenProps<MeetupsStackParams, "EventDetail">;

export function EventDetail({ route, navigation }: Props) {
  const { eventId } = route.params;
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  // moment conditional sheet
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [condModeLabel, setCondModeLabel] = useState<CondModeLabel>("At least one");
  const [condPicked, setCondPicked] = useState<string[]>([]);
  const phaseRef = useRef<string>("");
  // Suggestion ids with an in-flight toggleReaction: while pending we skip applying poll data so the
  // optimistic chip never flickers (the next clean poll reconciles the true public count).
  const pendingReact = useRef<Set<string>>(new Set());

  const load = useCallback(() => {
    return trpc.events.get
      .query({ id: eventId })
      .then((d) => {
        if (d && pendingReact.current.size === 0) setData(d);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [eventId]);

  // Busy-guarded mutate-then-reload runner shared by lock/addCandidate/answer/changeAnswer.
  const runAction = useBusyAction({ busy, setBusy, setError, load });

  // The 1s ticker only drives the live moment countdown, so only run it during the moment.
  const now = useLiveClock(
    TICK_MS,
    useCallback(() => phaseRef.current === "moment" || phaseRef.current === "collecting", []),
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load();
      // Poll while the plan is live so the tally, countdown and reveal converge without a refresh.
      const poll = setInterval(() => {
        if (active && phaseRef.current !== "cleared" && phaseRef.current !== "fizzled") load();
      }, 5000);
      return () => {
        active = false;
        clearInterval(poll);
      };
    }, [load]),
  );

  phaseRef.current = data?.phase ?? "";

  // One public +1 / un-+1 on a candidate (either kind), optimistic. Adding a reaction also clears
  // the caller's opt-out (server-side); a failed toggle reverts; the 5s poll reconciles.
  function toggleReaction(candidateId: string) {
    const flipMine = <T extends { id: string; mine: boolean; count: number }>(rows: T[]): T[] =>
      rows.map((c) =>
        c.id === candidateId ? { ...c, mine: !c.mine, count: c.count + (c.mine ? -1 : 1) } : c,
      );
    // Apply forces iOptedOut:false (a +1 rejoins, mirroring the server). The revert flips mine/count
    // back AND restores the prior opt-out, so a failed toggle on an opted-out plan does not leave the
    // "I can't make it" checkbox wrongly cleared until the next poll.
    const flip =
      (optedOut: boolean) =>
      (d: Detail | null): Detail | null =>
        d
          ? {
              ...d,
              timeCandidates: flipMine(d.timeCandidates),
              activityCandidates: flipMine(d.activityCandidates),
              iOptedOut: optedOut,
            }
          : d;
    const prevOptedOut = data?.iOptedOut ?? false;
    setData(flip(false));
    pendingReact.current.add(candidateId);
    trpc.events.toggleReaction
      .mutate({ eventId, candidateId })
      .catch(() => setData(flip(prevOptedOut)))
      .finally(() => pendingReact.current.delete(candidateId));
  }

  // "I can't make it" - a reversible, private exit. Optimistic; tapping any candidate above rejoins
  // (server clears the opt-out on a reaction). The 5s poll reconciles.
  function toggleOptOut() {
    const next = !(data?.iOptedOut ?? false);
    setData((d) => (d ? { ...d, iOptedOut: next } : d));
    trpc.events.setOptOut
      .mutate({ eventId, out: next })
      .catch(() => setData((d) => (d ? { ...d, iOptedOut: !next } : d)));
  }

  function lock(candidateId?: string) {
    return runAction(() =>
      trpc.events.lock.mutate(
        candidateId ? { eventId, candidateId, momentMinutes: 60 } : { eventId, momentMinutes: 60 },
      ),
    );
  }

  // Add a candidate while collecting (server +1s it for the author); refetch so it shows. Kind-gated
  // server-side: a time when lockTimes / an activity when lockThings is FORBIDDEN (UI hides the add).
  function addTime(startsAt: string, partOfDay?: PartOfDay) {
    return runAction(() =>
      trpc.events.addCandidate.mutate(
        partOfDay
          ? { eventId, kind: "time", startsAt, partOfDay }
          : { eventId, kind: "time", startsAt },
      ),
    );
  }

  function addActivity(text: string) {
    return runAction(() => trpc.events.addCandidate.mutate({ eventId, kind: "activity", text }));
  }

  function answer(
    kind: "yes" | "no" | "conditional",
    cond?: { mode: "all" | "any"; targetIds: string[] },
  ) {
    return runAction(async () => {
      await trpc.events.respond.mutate(cond ? { eventId, kind, cond } : { eventId, kind });
      setEditing(false);
    });
  }

  // "Change my answer" un-commits: it clears the response so the plan returns to Action Required
  // until a new answer is given, then reopens the choices.
  function changeAnswer() {
    return runAction(async () => {
      await trpc.events.unrespond.mutate({ eventId });
      setEditing(true);
    });
  }

  if (loading) return <ScreenLoading />;
  if (error || !data)
    return (
      <DetailError
        error={error}
        onBack={() => navigation.goBack()}
        notFoundLabel="Plan not found."
      />
    );

  const liveMsLeft = data.momentEndsAt ? new Date(data.momentEndsAt).getTime() - now : 0;
  const liveMsToDecide = data.decidesBy ? new Date(data.decidesBy).getTime() - now : 0;
  // The chosen time, shown as a hero banner once a slot is locked (moment/cleared); collecting has
  // no single time yet.
  const heroIso = data.chosenStartsAt && data.phase !== "collecting" ? data.chosenStartsAt : null;
  const heroClock = heroIso ? clock12(heroIso) : null;

  function headerSticker() {
    // Only the cleared phase gets a sticker; collecting + moment use the full-bleed countdown banner.
    if (data?.phase === "cleared") return <StickerTag label="It's on" />;
    return null;
  }

  let statusLine: string;
  switch (data.myStatus) {
    case "going":
      statusLine = "You're in";
      break;
    case "declined":
      statusLine = "You can't make it";
      break;
    default:
      statusLine = "Awaiting your answer";
  }

  return (
    <ScreenBackground
      header={<BackBar title={data.groupName} onBack={() => navigation.goBack()} />}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
      >
        {data.phase === "collecting" && data.decidesBy && (
          <CountdownBanner label="Decides by" ms={liveMsToDecide} note="most-wanted wins" />
        )}
        {data.phase === "moment" && (
          <CountdownBanner label="Closes in" ms={liveMsLeft} note="who's in reveals then" />
        )}

        <Card padding={0}>
          {heroIso && heroClock ? (
            <View
              style={{
                paddingHorizontal: 16,
                paddingTop: 14,
                paddingBottom: 12,
                borderBottomWidth: ui.border,
                borderBottomColor: ui.ink,
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <View>
                <Text
                  style={{ fontFamily: font.mono, fontSize: 12, letterSpacing: 1, color: ui.muted }}
                >
                  {dayUpper(heroIso)}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 3 }}>
                  <Text
                    style={{ fontFamily: font.mono, fontSize: 34, lineHeight: 36, color: ui.ink }}
                  >
                    {heroClock.time}
                  </Text>
                  <Text
                    style={{
                      fontFamily: font.mono,
                      fontSize: 16,
                      color: ui.muted,
                      marginLeft: 5,
                      marginBottom: 3,
                    }}
                  >
                    {heroClock.ampm}
                  </Text>
                </View>
              </View>
              {headerSticker()}
            </View>
          ) : null}
          <View style={{ paddingHorizontal: 16, paddingTop: heroIso ? 14 : 16, paddingBottom: 16 }}>
            <Text
              style={{ fontFamily: font.display, fontSize: 24, letterSpacing: -0.5, color: ui.ink }}
            >
              {data.title}
            </Text>
            {data.location ? (
              <Text
                style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted, marginTop: 4 }}
              >
                at <Text style={{ fontFamily: font.bold, color: ui.ink }}>{data.location}</Text>
              </Text>
            ) : null}
            {data.description ? (
              <Text
                style={{
                  fontFamily: font.medium,
                  fontSize: 12,
                  color: ui.muted,
                  marginTop: 8,
                  lineHeight: 18,
                }}
              >
                {data.description}
              </Text>
            ) : null}
          </View>
        </Card>

        {data.phase === "collecting" && (
          <CollectingView
            data={data}
            optedOut={data.iOptedOut}
            busy={busy}
            onToggleReaction={toggleReaction}
            onToggleOptOut={toggleOptOut}
            onLock={lock}
            onAddTime={addTime}
            onAddActivity={addActivity}
          />
        )}

        {data.phase === "moment" && (
          <MomentView
            data={data}
            busy={busy}
            editing={editing}
            onEdit={changeAnswer}
            statusLine={statusLine}
            onYes={() => answer("yes")}
            onNo={() => answer("no")}
            onConditional={() => {
              setCondPicked([]);
              setSheet(true);
            }}
          />
        )}

        {data.phase === "cleared" && <RevealView data={data} statusLine={statusLine} />}

        {data.phase === "fizzled" && (
          <View style={{ marginTop: 16 }}>
            <Card>
              <Text style={{ fontFamily: font.display, fontSize: 15, color: ui.ink }}>
                This one didn't come together
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
                Not enough people were keen this time - no worries, no fuss. Suggest another
                whenever.
              </Text>
            </Card>
          </View>
        )}
      </ScrollView>

      <BottomSheet visible={sheet} onClose={() => setSheet(false)}>
        <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink }}>I'll go if...</Text>
        <Text
          style={{
            fontFamily: font.medium,
            fontSize: 10,
            color: ui.muted,
            marginTop: 2,
            marginBottom: 10,
          }}
        >
          ...these people are going
        </Text>
        <Toggle
          options={["At least one", "All of them"]}
          value={condModeLabel}
          onChange={setCondModeLabel}
        />
        <View style={{ marginTop: 12, marginBottom: 4 }}>
          {data.members.map((m: Member) => {
            const on = condPicked.includes(m.id);
            return (
              <Pressable
                key={m.id}
                onPress={() =>
                  setCondPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))
                }
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 }}
              >
                <Avatar initial={m.name.charAt(0).toUpperCase()} color={ui.muted} size={26} />
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{m.name}</Text>
                <View style={{ marginLeft: "auto" }}>
                  <SelectCheck selected={on} />
                </View>
              </Pressable>
            );
          })}
          {data.members.length === 0 && (
            <Text style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted }}>
              No one else in this group.
            </Text>
          )}
        </View>
        <Button
          label="Confirm"
          variant="primary"
          disabled={!condPicked.length || busy}
          onPress={() => {
            setSheet(false);
            answer("conditional", {
              mode: condModeLabel === "All of them" ? "all" : "any",
              targetIds: condPicked,
            });
          }}
          style={{ marginTop: 12 }}
        />
      </BottomSheet>
    </ScreenBackground>
  );
}

// A full-bleed countdown bar for the time-pressured phases (the collecting deadline and the moment
// reveal). Stretches edge-to-edge with top/bottom ink rules - visually distinct from rounded cards.
function CountdownBanner({ label, ms, note }: { label: string; ms: number; note: string }) {
  return (
    <View
      style={{
        marginHorizontal: -16,
        marginTop: -2,
        marginBottom: 14,
        backgroundColor: ui.brand,
        borderColor: ui.ink,
        borderTopWidth: ui.border,
        borderBottomWidth: ui.border,
        paddingVertical: 14,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <View>
        <Text
          style={{
            fontFamily: font.bold,
            fontSize: 9,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: "#fff",
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            fontFamily: font.black,
            fontSize: 28,
            letterSpacing: -1,
            color: "#fff",
            marginTop: 2,
          }}
        >
          {formatCountdown(ms)}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: font.bold,
          fontSize: 10,
          color: "#fff",
          opacity: 0.92,
          maxWidth: 130,
          textAlign: "right",
        }}
      >
        {note}
      </Text>
    </View>
  );
}

// Collecting: PUBLIC vote board. Two candidate lists - TIME and ACTIVITY (what/where) - each a
// table of rows with a checkbox (the caller's own +1) and the public count. Add controls are hidden
// when the creator locked that axis. No names - the counts are the group's momentum.
function CollectingView({
  data,
  optedOut,
  busy,
  onToggleReaction,
  onToggleOptOut,
  onLock,
  onAddTime,
  onAddActivity,
}: {
  data: Detail;
  optedOut: boolean;
  busy: boolean;
  onToggleReaction: (candidateId: string) => void;
  onToggleOptOut: () => void;
  onLock: (candidateId?: string) => void;
  onAddTime: (startsAt: string, partOfDay?: PartOfDay) => void;
  onAddActivity: (text: string) => void;
}) {
  return (
    <View style={{ marginTop: 16 }}>
      {(data.activityCandidates.length > 0 || !data.lockThings) && (
        <Section title="What / where">
          {data.activityCandidates.map((c: ActivityCand) => (
            <VoteRow
              key={c.id}
              label={c.text}
              count={c.count}
              mine={c.mine}
              onPress={() => onToggleReaction(c.id)}
            />
          ))}
          {!data.lockThings && <AddActivity busy={busy} onAdd={onAddActivity} />}
        </Section>
      )}

      {(data.timeCandidates.length > 0 || !data.lockTimes) && (
        <Section title="When works?">
          {data.timeCandidates.map((c: TimeCand) => (
            <VoteRow
              key={c.id}
              label={timeChipLabel(c)}
              count={c.count}
              mine={c.mine}
              onPress={() => onToggleReaction(c.id)}
            />
          ))}
          {!data.lockTimes && <AddTime busy={busy} data={data} onAdd={onAddTime} />}
        </Section>
      )}

      {/* Opt-out: a distinct, tinted row (private, reversible). */}
      <Pressable
        onPress={onToggleOptOut}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: 12,
          borderRadius: ui.rInput,
          backgroundColor: "#F1EEF6",
          borderWidth: ui.border,
          borderColor: ui.ink,
        }}
      >
        <SelectCheck selected={optedOut} accent={ui.ink} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>
            I can't make it
          </Text>
          <Text style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted }}>
            tap anything above to rejoin
          </Text>
        </View>
      </Pressable>

      <Text
        style={{
          fontFamily: font.medium,
          fontSize: 10,
          color: ui.muted,
          textAlign: "center",
          marginTop: 16,
        }}
      >
        No names - just the group.
      </Text>

      {/* No manual lock for members (pure deadline); this dev-only button forces it for demos. Needs
          at least one time candidate to lock onto - otherwise the server rejects it (nothing to schedule). */}
      {__DEV__ && data.isCreator && data.timeCandidates.length > 0 && (
        <View style={{ marginTop: 16 }}>
          <Button
            label="Decide now (dev)"
            variant="outline"
            disabled={busy}
            onPress={() => onLock()}
          />
        </View>
      )}
    </View>
  );
}

// A time row label: the concrete slot, with the part-of-day hint appended when present.
function timeChipLabel(c: TimeCand): string {
  const slot = formatSlot(c.startsAt);
  return c.partOfDay ? `${slot} · ${partOfDayLabel(c.partOfDay)}` : slot;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={{ fontFamily: font.display, fontSize: 13, color: ui.ink, marginBottom: 10 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

// A votable candidate as a table row: a checkbox (the caller's own +1), the label, and the public
// count on the right. Tapping toggles the +1. No names - the count is the group's momentum.
function VoteRow({
  label,
  count,
  mine,
  onPress,
}: {
  label: string;
  count: number;
  mine: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 11,
        paddingHorizontal: 13,
        marginBottom: 8,
        borderRadius: ui.rInput,
        borderWidth: ui.border,
        borderColor: ui.ink,
        backgroundColor: mine ? "#F1EEF6" : ui.surface,
      }}
    >
      <SelectCheck selected={mine} />
      <Text style={{ flex: 1, fontFamily: font.bold, fontSize: 14, color: ui.ink }}>{label}</Text>
      <Text style={{ fontFamily: font.mono, fontSize: 12, color: ui.muted }}>{count}</Text>
    </Pressable>
  );
}

// Inline free-text activity entry: a + that opens a field; de-duped case-insensitively server-side.
function AddActivity({ busy, onAdd }: { busy: boolean; onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={6} style={{ marginTop: 2 }}>
        <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.brand }}>
          + add a place/thing
        </Text>
      </Pressable>
    );
  }
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
    setOpen(false);
  };
  return (
    <View style={{ marginTop: 6 }}>
      <Field
        label="Add a place or thing"
        value={text}
        onChangeText={setText}
        placeholder="bowling, the pub..."
      />
      <View style={{ flexDirection: "row", gap: 16, marginTop: 12, justifyContent: "flex-end" }}>
        <Pressable
          hitSlop={8}
          onPress={() => {
            setText("");
            setOpen(false);
          }}
        >
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.muted }}>Cancel</Text>
        </Pressable>
        <View style={{ width: 110 }}>
          <Button label="Add" variant="primary" disabled={busy || !text.trim()} onPress={submit} />
        </View>
      </View>
    </View>
  );
}

// Inline concrete time entry: a + that opens a date/time pill, bounded to a sensible horizon from
// the existing candidate spread. De-duped by minute server-side.
function AddTime({
  busy,
  data,
  onAdd,
}: {
  busy: boolean;
  data: Detail;
  onAdd: (startsAt: string, partOfDay?: PartOfDay) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const newIso = isoFrom(newDate, newTime);

  const times = data.timeCandidates.map((c: TimeCand) => new Date(c.startsAt).getTime());
  const decideMs = data.decidesBy ? new Date(data.decidesBy).getTime() : Date.now();
  const addMinDate = new Date(Math.max(Date.now(), decideMs));
  const addMaxDate = new Date(
    times.length
      ? addCandidateHorizon(Math.min(...times), Math.max(...times))
      : decideMs + 14 * 24 * 60 * 60 * 1000,
  );

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={6} style={{ marginTop: 2 }}>
        <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.brand }}>+ add a time</Text>
      </Pressable>
    );
  }
  return (
    <Card style={{ marginTop: 8 }}>
      <DateTimePill
        dateValue={newDate}
        timeValue={newTime}
        onDate={setNewDate}
        onTime={setNewTime}
        minimumDate={addMinDate}
        maximumDate={addMaxDate}
      />
      <View style={{ flexDirection: "row", gap: 16, marginTop: 14, justifyContent: "flex-end" }}>
        <Pressable
          hitSlop={8}
          onPress={() => {
            setNewDate("");
            setNewTime("");
            setOpen(false);
          }}
        >
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.muted }}>Cancel</Text>
        </Pressable>
        <View style={{ width: 110 }}>
          <Button
            label="Add"
            variant="primary"
            disabled={busy || !newIso}
            onPress={() => {
              if (!newIso) return;
              onAdd(newIso);
              setNewDate("");
              setNewTime("");
              setOpen(false);
            }}
          />
        </View>
      </View>
    </Card>
  );
}

// Moment: a blind, timed commitment. We never show who else is in until the timer ends.
function MomentView({
  data,
  busy,
  editing,
  onEdit,
  statusLine,
  onYes,
  onNo,
  onConditional,
}: {
  data: Detail;
  busy: boolean;
  editing: boolean;
  onEdit: () => void;
  statusLine: string;
  onYes: () => void;
  onNo: () => void;
  onConditional: () => void;
}) {
  const showAnswer = editing || !data.myResponse;
  // A blind conditional reads as "awaiting" server-side (we cannot resolve it without leaking), so
  // give the committed-conditional case its own heading instead of the misleading "Awaiting...".
  const lockedHeading =
    data.myResponse?.kind === "conditional" ? "You're in if your people are" : statusLine;
  return (
    <View style={{ marginTop: 16 }}>
      {showAnswer ? (
        <>
          <Text style={{ fontFamily: font.display, fontSize: 14, color: ui.ink, marginBottom: 4 }}>
            Are you in?
          </Text>
          <Text
            style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginBottom: 10 }}
          >
            No one sees who's in until the timer ends. Answer honestly.
          </Text>
          <Button
            label={"✓  I'm in"}
            variant="affirmative"
            disabled={busy}
            onPress={onYes}
            style={{ marginBottom: 10 }}
          />
          <Button
            label="I'll go if..."
            variant="outline"
            disabled={busy}
            onPress={onConditional}
            style={{ marginBottom: 10 }}
          />
          <Button label="Can't make it" variant="outline" disabled={busy} onPress={onNo} />
        </>
      ) : (
        <>
          <Text style={{ fontFamily: font.bold, fontSize: 14, color: ui.ink, marginBottom: 12 }}>
            {lockedHeading}
          </Text>
          <Card>
            <Text
              style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted, lineHeight: 18 }}
            >
              Locked in. Who's in is revealed when the timer ends - hang tight.
            </Text>
          </Card>
          <Button
            label="Change my answer"
            variant="outline"
            disabled={busy}
            onPress={onEdit}
            style={{ marginTop: 12 }}
          />
        </>
      )}
    </View>
  );
}

// Reveal: the plan cleared - show the crowd who's in (only the IN crowd is ever listed).
function RevealView({ data, statusLine }: { data: Detail; statusLine: string }) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ fontFamily: font.bold, fontSize: 14, color: ui.ink, marginBottom: 12 }}>
        {statusLine}
      </Text>
      <Text
        style={{
          fontFamily: font.bold,
          fontSize: 9,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: ui.muted,
          marginBottom: 8,
        }}
      >
        Who's in
      </Text>
      <Card padding={0}>
        {data.going.map((p, i) => (
          <PersonRow
            key={p.id}
            name={p.name}
            color={p.color}
            index={i}
            right={<Text style={{ marginLeft: "auto", color: ui.going }}>{"✓"}</Text>}
          />
        ))}
        {data.going.length === 0 && (
          <Text style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted, padding: 14 }}>
            No one's in.
          </Text>
        )}
      </Card>
    </View>
  );
}
