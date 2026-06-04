import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { formatSlot, isoFrom, splitIso } from "../lib/format";
import { defaultDecidesByForCandidates, defaultReplyByMs, MOMENT_MS } from "../lib/lock";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import {
  BackBar,
  Button,
  Card,
  Chip,
  DateTimePill,
  Field,
  Row,
  ScreenBackground,
  ScreenLoading,
} from "../ui";

type Group = Awaited<ReturnType<typeof trpc.groups.mine.query>>[number];
type TimeRow = { id: string; date: string; time: string };
type Props = NativeStackScreenProps<MeetupsStackParams, "CreateWizard">;

const STEPS = ["group", "activities", "times", "options", "confirm"] as const;

export function CreateWizard({ navigation }: Props) {
  const [step, setStep] = useState(0);
  const stepKey = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  // Title is optional - leave it blank and the server resolves the winning activity into it at lock.
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  // Activity ("what") candidates - ideas, optional, no names ever shown.
  const [activityChips, setActivityChips] = useState<string[]>([]);
  const [activityDraft, setActivityDraft] = useState("");
  // Time candidates - concrete multi-row date/time rows, optional.
  const [rows, setRows] = useState<TimeRow[]>([{ id: "t0", date: "", time: "" }]);
  const nextRowId = useRef(1);
  // Creator locks - both default OFF (open). Decides-by is editable.
  const [lockTimes, setLockTimes] = useState(false);
  const [lockThings, setLockThings] = useState(false);
  const [decidesEdit, setDecidesEdit] = useState(false);
  const [decidesDate, setDecidesDate] = useState("");
  const [decidesTime, setDecidesTime] = useState("");
  // Reply-by (the RSVP window close) is editable too - only offered once a time is on the table.
  const [replyEdit, setReplyEdit] = useState(false);
  const [replyDate, setReplyDate] = useState("");
  const [replyTime, setReplyTime] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const updateRow = (id: string, patch: Partial<TimeRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  useEffect(() => {
    trpc.groups.mine
      .query()
      .then((mine) => {
        setGroups(mine);
        if (mine[0]) setGroupId(mine[0].id);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const timeIsos = rows.map((r) => isoFrom(r.date, r.time)).filter((x): x is string => x !== null);
  const earliestMs = timeIsos.length
    ? Math.min(...timeIsos.map((iso) => new Date(iso).getTime()))
    : null;
  const autoDecidesIso =
    earliestMs != null
      ? new Date(defaultDecidesByForCandidates(earliestMs, Date.now())).toISOString()
      : null;
  const decidesOverrideIso = decidesEdit ? isoFrom(decidesDate, decidesTime) : null;
  // Match the server bound (events.create): a custom deadline must leave a full moment of headroom
  // before the earliest time, not just land before it - otherwise submit fails server-side.
  const decidesInvalid =
    !!decidesOverrideIso &&
    earliestMs != null &&
    new Date(decidesOverrideIso).getTime() > earliestMs - MOMENT_MS;
  const decidesToSend =
    decidesEdit && decidesOverrideIso && !decidesInvalid ? decidesOverrideIso : undefined;
  const activityCount = activityChips.length + (activityDraft.trim() ? 1 : 0);
  // You can only lock an axis that has something on it (you can't fix nothing). A lock with no
  // candidate is ignored, so the checkbox is disabled until at least one exists.
  const canLockTimes = timeIsos.length > 0;
  const canLockActivity = activityCount > 0;
  const lockTimesEff = lockTimes && canLockTimes;
  const lockThingsEff = lockThings && canLockActivity;
  // Concrete shortcut: skip voting only when BOTH axes are pinned - one locked time AND a locked
  // activity. Must match the server's planOpensMoment so the preview never diverges.
  const isConcrete = timeIsos.length === 1 && lockTimesEff && lockThingsEff && activityCount <= 1;

  // Reply-by: the blind RSVP window opens at the vote-close (or now, for a concrete plan) and must sit
  // after it and no later than the earliest time. Default + cap mirror the server (defaultReplyByMs).
  const replyFloorMs = isConcrete
    ? Date.now()
    : decidesToSend
      ? new Date(decidesToSend).getTime()
      : autoDecidesIso
        ? new Date(autoDecidesIso).getTime()
        : Date.now();
  const autoReplyIso =
    earliestMs != null ? new Date(defaultReplyByMs(replyFloorMs, earliestMs)).toISOString() : null;
  const replyOverrideIso = replyEdit ? isoFrom(replyDate, replyTime) : null;
  const replyInvalid =
    !!replyOverrideIso &&
    earliestMs != null &&
    (new Date(replyOverrideIso).getTime() <= replyFloorMs ||
      new Date(replyOverrideIso).getTime() > earliestMs);
  // Always send the reply-by we showed (the edit, or the default), so the server stores exactly what
  // the creator saw and uses it at lock - never recomputing its own default (anchored to lock time,
  // which would diverge from the shown value, e.g. after a dev "decide now").
  const replyToSend =
    autoReplyIso == null
      ? undefined
      : replyEdit && replyOverrideIso && !replyInvalid
        ? replyOverrideIso
        : autoReplyIso;

  function valid(key: string): boolean {
    switch (key) {
      case "group":
        return !!groupId;
      case "options":
        return !decidesInvalid && !replyInvalid;
      default:
        return true; // activities, times, confirm - all optional
    }
  }

  // Fold the typed-but-not-added activity into the chip list (case-insensitive de-dup), returning
  // the resulting set so submit can use it synchronously.
  function commitDraftActivity(): string[] {
    const t = activityDraft.trim();
    if (!t) return activityChips;
    setActivityDraft("");
    if (activityChips.some((c) => c.toLowerCase() === t.toLowerCase())) return activityChips;
    const next = [...activityChips, t];
    setActivityChips(next);
    return next;
  }

  function startEditDecides() {
    if (autoDecidesIso) {
      const { date, time } = splitIso(autoDecidesIso);
      setDecidesDate(date);
      setDecidesTime(time);
    }
    setDecidesEdit(true);
  }

  function startEditReply() {
    if (autoReplyIso) {
      const { date, time } = splitIso(autoReplyIso);
      setReplyDate(date);
      setReplyTime(time);
    }
    setReplyEdit(true);
  }

  async function submit() {
    if (busy || !groupId) return;
    setBusy(true);
    const activities = commitDraftActivity();
    try {
      await trpc.events.create.mutate({
        groupId,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        timeCandidates: timeIsos.map((startsAt) => ({ startsAt })),
        activityCandidates: activities.length ? activities : undefined,
        lockTimes: lockTimesEff,
        lockThings: lockThingsEff,
        decidesBy: decidesToSend,
        replyBy: replyToSend,
      });
      navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] });
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  function goNext() {
    if (!valid(stepKey) || busy) return;
    if (stepKey === "activities") commitDraftActivity();
    if (isLastStep) submit();
    else setStep(step + 1);
  }
  function goBack() {
    if (step > 0) setStep(step - 1);
    else navigation.goBack();
  }

  if (loading) return <ScreenLoading />;

  const nextLabel = isLastStep ? "Send to the group" : "Next";

  return (
    <ScreenBackground header={<BackBar title="New meetup" onBack={goBack} />}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <ProgressDots steps={STEPS} index={step} />
          {error && (
            <Text style={{ fontFamily: font.medium, color: ui.brand, marginBottom: 10 }}>
              Something went wrong. Try again.
            </Text>
          )}

          {stepKey === "group" && (
            <Step title="Who's it for?">
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {groups.map((g) => (
                  <Chip
                    key={g.id}
                    label={g.name}
                    selected={groupId === g.id}
                    onPress={() => setGroupId(g.id)}
                  />
                ))}
                {groups.length === 0 && (
                  <Text style={{ fontFamily: font.medium, fontSize: 13, color: ui.muted }}>
                    You're not in any groups yet.
                  </Text>
                )}
              </View>
            </Step>
          )}

          {stepKey === "activities" && (
            <Step
              title="What do you fancy?"
              sub="Drop a few activities - optional, and the group can add more. No names - it's the group's."
            >
              {activityChips.map((c) => (
                <Row key={c}>
                  <Text style={{ flex: 1, fontFamily: font.bold, fontSize: 14, color: ui.ink }}>
                    {c}
                  </Text>
                  <Pressable
                    onPress={() => setActivityChips((cs) => cs.filter((x) => x !== c))}
                    hitSlop={10}
                  >
                    <Text style={{ fontFamily: font.bold, fontSize: 16, color: ui.muted }}>×</Text>
                  </Pressable>
                </Row>
              ))}
              <Field
                label="Add an activity"
                optional
                value={activityDraft}
                onChangeText={setActivityDraft}
                placeholder="bowling, the pub..."
                right={
                  <Pressable
                    onPress={commitDraftActivity}
                    hitSlop={8}
                    disabled={!activityDraft.trim()}
                  >
                    <Text
                      style={{
                        fontFamily: font.bold,
                        fontSize: 13,
                        color: activityDraft.trim() ? ui.brand : ui.muted,
                      }}
                    >
                      Add
                    </Text>
                  </Pressable>
                }
              />
              <CheckRow
                label="Lock the activity"
                sub={
                  canLockActivity ? "The group can't add more activities" : "Add an activity first"
                }
                on={lockThingsEff}
                disabled={!canLockActivity}
                onToggle={() => setLockThings((v) => !v)}
              />
            </Step>
          )}

          {stepKey === "times" && (
            <Step
              title="When could it be?"
              sub="Offer a time or two, or skip - people react and the best-supported wins. Optional."
            >
              {rows.map((r) => (
                <View key={r.id} style={{ position: "relative", marginBottom: 10 }}>
                  <DateTimePill
                    dateValue={r.date}
                    timeValue={r.time}
                    onDate={(t) => updateRow(r.id, { date: t })}
                    onTime={(t) => updateRow(r.id, { time: t })}
                    minimumDate={new Date()}
                  />
                  {rows.length > 1 && (
                    <RemoveDot onPress={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} />
                  )}
                </View>
              ))}
              {rows.length < 10 && (
                <Chip
                  label="+ Add a time"
                  onPress={() =>
                    setRows((rs) => [...rs, { id: `t${nextRowId.current++}`, date: "", time: "" }])
                  }
                />
              )}
              <CheckRow
                label="Lock the times"
                sub={canLockTimes ? "The group can't add more times" : "Add a time first"}
                on={lockTimesEff}
                disabled={!canLockTimes}
                onToggle={() => setLockTimes((v) => !v)}
              />
            </Step>
          )}

          {stepKey === "options" && (
            <Step title="A few options" sub="All optional - skip if you like.">
              <Field
                label="Title"
                optional
                value={title}
                onChangeText={setTitle}
                placeholder="Bowling night"
              />
              <Field
                label="Location"
                optional
                value={location}
                onChangeText={setLocation}
                placeholder="TenPin Bexleyheath"
                style={{ marginTop: 12 }}
              />
              <Field
                label="Notes"
                optional
                value={description}
                onChangeText={setDescription}
                placeholder="Come at 6, we'll eat around 8"
                multiline
                style={{ marginTop: 12 }}
              />
              {!isConcrete && (
                <>
                  <Text
                    style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink, marginTop: 18 }}
                  >
                    Decides by
                  </Text>
                  {decidesEdit ? (
                    <Card style={{ marginTop: 8 }}>
                      <DateTimePill
                        dateValue={decidesDate}
                        timeValue={decidesTime}
                        onDate={setDecidesDate}
                        onTime={setDecidesTime}
                        minimumDate={new Date()}
                      />
                      {decidesInvalid && (
                        <Text
                          style={{
                            fontFamily: font.medium,
                            fontSize: 11,
                            color: ui.brand,
                            marginTop: 8,
                          }}
                        >
                          It has to decide at least an hour before your earliest time.
                        </Text>
                      )}
                      <View style={{ flexDirection: "row", marginTop: 12 }}>
                        <Chip
                          label="Use default"
                          onPress={() => {
                            setDecidesEdit(false);
                            setDecidesDate("");
                            setDecidesTime("");
                          }}
                        />
                      </View>
                    </Card>
                  ) : (
                    <Card style={{ marginTop: 8 }}>
                      <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>
                        {autoDecidesIso
                          ? `Decides ${formatSlot(autoDecidesIso)}`
                          : "A sensible deadline"}
                      </Text>
                      <Text
                        style={{
                          fontFamily: font.medium,
                          fontSize: 11,
                          color: ui.muted,
                          marginTop: 3,
                        }}
                      >
                        {autoDecidesIso
                          ? "before your earliest time - best-supported wins"
                          : "add times to set this, or we'll pick a horizon"}
                      </Text>
                      {autoDecidesIso && (
                        <View style={{ flexDirection: "row", marginTop: 10 }}>
                          <Chip label="Change" onPress={startEditDecides} />
                        </View>
                      )}
                    </Card>
                  )}
                </>
              )}

              {earliestMs != null && (
                <>
                  <Text
                    style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink, marginTop: 18 }}
                  >
                    Reply by
                  </Text>
                  {replyEdit ? (
                    <Card style={{ marginTop: 8 }}>
                      <DateTimePill
                        dateValue={replyDate}
                        timeValue={replyTime}
                        onDate={setReplyDate}
                        onTime={setReplyTime}
                        minimumDate={new Date(replyFloorMs)}
                        maximumDate={new Date(earliestMs)}
                      />
                      {replyInvalid && (
                        <Text
                          style={{
                            fontFamily: font.medium,
                            fontSize: 11,
                            color: ui.brand,
                            marginTop: 8,
                          }}
                        >
                          Replies close after voting ends and no later than your earliest time.
                        </Text>
                      )}
                      <View style={{ flexDirection: "row", marginTop: 12 }}>
                        <Chip
                          label="Use default"
                          onPress={() => {
                            setReplyEdit(false);
                            setReplyDate("");
                            setReplyTime("");
                          }}
                        />
                      </View>
                    </Card>
                  ) : (
                    <Card style={{ marginTop: 8 }}>
                      <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>
                        {autoReplyIso
                          ? `Replies close ${formatSlot(autoReplyIso)}`
                          : "A sensible deadline"}
                      </Text>
                      <Text
                        style={{
                          fontFamily: font.medium,
                          fontSize: 11,
                          color: ui.muted,
                          marginTop: 3,
                        }}
                      >
                        blind until then - then it reveals who's in
                      </Text>
                      {autoReplyIso && (
                        <View style={{ flexDirection: "row", marginTop: 10 }}>
                          <Chip label="Change" onPress={startEditReply} />
                        </View>
                      )}
                    </Card>
                  )}
                </>
              )}
            </Step>
          )}

          {stepKey === "confirm" && (
            <Step title="Ready to send?">
              <Card>
                <Text
                  style={{ fontFamily: font.bold, fontSize: 14, color: ui.ink, lineHeight: 21 }}
                >
                  {confirmMirror({
                    timeCount: timeIsos.length,
                    activityCount,
                    timeFixed: timeIsos.length === 1 && lockTimesEff,
                    activityFixed: lockThingsEff && activityCount <= 1,
                    firstTimeIso: timeIsos[0] ?? null,
                  })}
                </Text>
                <Text
                  style={{
                    fontFamily: font.medium,
                    fontSize: 12,
                    color: ui.muted,
                    marginTop: 12,
                    lineHeight: 18,
                  }}
                >
                  No names - it's the group's.
                </Text>
              </Card>
            </Step>
          )}

          <Button
            label={nextLabel}
            variant="primary"
            disabled={!valid(stepKey) || busy}
            onPress={goNext}
            style={{ marginTop: 24 }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

function ProgressDots({ steps, index }: { steps: readonly string[]; index: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 6, marginBottom: 16 }}>
      {steps.map((stepKey, i) => (
        <View
          key={stepKey}
          style={{
            width: i === index ? 22 : 8,
            height: 8,
            borderRadius: 999,
            borderWidth: 1.5,
            borderColor: ui.ink,
            backgroundColor: i <= index ? ui.ink : "transparent",
          }}
        />
      ))}
    </View>
  );
}

function Step({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <View>
      <Text style={{ fontFamily: font.display, fontSize: 22, letterSpacing: -0.5, color: ui.ink }}>
        {title}
      </Text>
      {sub ? (
        <Text
          style={{
            fontFamily: font.medium,
            fontSize: 12,
            color: ui.muted,
            marginTop: 6,
            marginBottom: 14,
            lineHeight: 18,
          }}
        >
          {sub}
        </Text>
      ) : (
        <View style={{ height: 14 }} />
      )}
      {children}
    </View>
  );
}

function RemoveDot({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      style={{
        position: "absolute",
        top: -8,
        right: -8,
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: ui.surface,
        borderWidth: ui.border,
        borderColor: ui.ink,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: font.bold, fontSize: 13, lineHeight: 13, color: ui.ink }}>×</Text>
    </Pressable>
  );
}

function CheckRow({
  label,
  sub,
  on,
  onToggle,
  disabled = false,
}: {
  label: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onToggle}
      style={{
        flexDirection: "row",
        alignItems: "center",
        marginTop: 16,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: ui.border,
          borderColor: ui.ink,
          backgroundColor: on ? ui.ink : "transparent",
          alignItems: "center",
          justifyContent: "center",
          marginRight: 12,
        }}
      >
        {on && (
          <Text style={{ fontFamily: font.bold, fontSize: 13, lineHeight: 13, color: "#fff" }}>
            ✓
          </Text>
        )}
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{label}</Text>
        <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 1 }}>
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

// The plain-English outcome mirror. It describes each axis by whether it is FIXED (locked to its
// candidates so there is nothing to vote on) or still being decided, so the preview matches what the
// server actually does. Both fixed => concrete (skip voting); otherwise the open/contested axis is
// what the group votes on.
function confirmMirror({
  timeCount,
  activityCount,
  timeFixed,
  activityFixed,
  firstTimeIso,
}: {
  timeCount: number;
  activityCount: number;
  timeFixed: boolean;
  activityFixed: boolean;
  firstTimeIso: string | null;
}): string {
  // The WHEN clause.
  const when = timeFixed && firstTimeIso ? `It's on for ${formatSlot(firstTimeIso)}` : null;

  if (when) {
    // Time is set; only the activity (maybe) and the who's-in remain.
    if (activityFixed) {
      return activityCount === 1
        ? `${when} - the activity's set too, so the group just says who's in.`
        : `${when} - the group just says who's in.`;
    }
    return `${when} - the group decides what to do, then says who's in.`;
  }

  // Time is not fixed: the group converges on the time.
  const timePart =
    timeCount >= 1
      ? `the group votes on your ${timeCount} time${timeCount === 1 ? "" : "s"}`
      : "the group suggests the times";
  const activityPart = activityFixed
    ? activityCount === 1
      ? " (activity already set)"
      : ""
    : activityCount >= 1
      ? ` and picks from ${activityCount} ${activityCount === 1 ? "activity" : "activities"}`
      : " and what to do";
  return `No fixed time yet - ${timePart}${activityPart}, best-supported wins, then who's in.`;
}
