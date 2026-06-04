import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { ERR_SAVE, NO_NAMES, NOTE_TOP_PICK, STEP_COPY } from "../lib/copy";
import { formatSlot, isoFrom, splitIso } from "../lib/format";
import { defaultDecidesByForCandidates, defaultReplyByMs, MOMENT_MS } from "../lib/lock";
import { EMPTY_PREFILL, type Prefill, prefillFromMeetup, wizardSteps } from "../lib/redo";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import {
  AppText,
  Button,
  Card,
  CheckOption,
  Chip,
  DateTimePill,
  Field,
  FormError,
  Row,
  ScreenHeader,
  ScreenLoading,
  ScreenScroll,
  Section,
  SelectCheck,
  TextButton,
} from "../ui";

type Group = Awaited<ReturnType<typeof trpc.groups.mine.query>>[number];
type PastMeetup = Awaited<ReturnType<typeof trpc.events.pastForGroup.query>>[number];
type TimeRow = { id: string; date: string; time: string };
type Props = NativeStackScreenProps<MeetupsStackParams, "CreateWizard">;

export function CreateWizard({ navigation }: Props) {
  const [step, setStep] = useState(0);

  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [pastMeetups, setPastMeetups] = useState<PastMeetup[]>([]);
  // Whether the past-meetups query for the current group has settled. The "source" step is inserted
  // only once it has, so the group step gates Next on this - otherwise a late insert would shift the
  // step list under the user (stepKey is an index) and silently change the visible step.
  const [pastLoaded, setPastLoaded] = useState(false);
  // The source-step choice: null = not chosen yet, "fresh" = start blank, otherwise a past-meetup id.
  const [source, setSource] = useState<"fresh" | string | null>(null);

  const STEPS = wizardSteps(pastMeetups.length > 0);
  const stepKey = STEPS[step];
  const isLastStep = step === STEPS.length - 1;
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
  const [lockActivity, setLockActivity] = useState(false);
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

  // When the chosen group changes, refresh its redo list and drop any clone/source from the previous
  // group (the source step is only meaningful for the currently selected group). Intentionally keyed on
  // groupId alone - applyPrefill is a stable helper and re-running on its identity is not wanted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: groupId is the only intended trigger.
  useEffect(() => {
    if (!groupId) return;
    let active = true;
    setSource(null);
    setPastLoaded(false);
    applyPrefill(EMPTY_PREFILL);
    trpc.events.pastForGroup
      .query({ groupId })
      .then((m) => active && setPastMeetups(m))
      .catch(() => active && setPastMeetups([]))
      .finally(() => active && setPastLoaded(true));
    return () => {
      active = false;
    };
  }, [groupId]);

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
  const lockActivityEff = lockActivity && canLockActivity;
  // Concrete shortcut: skip voting only when BOTH axes are pinned - one locked time AND a locked
  // activity. Must match the server's planOpensMoment so the preview never diverges.
  const isConcrete = timeIsos.length === 1 && lockTimesEff && lockActivityEff && activityCount <= 1;

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
        // Wait for the past-meetups query so the step list is final before leaving this step.
        return !!groupId && pastLoaded;
      case "source":
        return source !== null;
      case "deadlines":
        return !decidesInvalid && !replyInvalid;
      default:
        return true; // activities, times, details, confirm - all optional
    }
  }

  function applyPrefill(p: Prefill) {
    setActivityChips(p.activityChips);
    setActivityDraft("");
    setLockTimes(p.lockTimes);
    setLockActivity(p.lockActivity);
    setLocation(p.location);
    setDescription(p.description);
    // Time is never carried - reset to a single blank row so the creator sets it fresh.
    setRows([{ id: "t0", date: "", time: "" }]);
    nextRowId.current = 1;
    setDecidesEdit(false);
    setReplyEdit(false);
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
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        timeCandidates: timeIsos.map((startsAt) => ({ startsAt })),
        activityCandidates: activities.length ? activities : undefined,
        lockTimes: lockTimesEff,
        lockActivity: lockActivityEff,
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
  const copy = STEP_COPY[stepKey];

  return (
    <ScreenScroll header={<ScreenHeader title="New meetup" onBack={goBack} />} avoidKeyboard>
      <ProgressDots steps={STEPS} index={step} />
      {error && <FormError>{ERR_SAVE}</FormError>}

      <Section title={copy.title} sub={copy.sub} size="lg">
        {stepKey === "group" && (
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
              <AppText variant="caption">You're not in any groups yet.</AppText>
            )}
          </View>
        )}

        {stepKey === "source" && (
          <>
            <SourceCard
              title="Start fresh"
              sub="A blank meetup"
              selected={source === "fresh"}
              onPress={() => {
                setSource("fresh");
                applyPrefill(EMPTY_PREFILL);
              }}
            />
            {pastMeetups.map((m) => (
              <SourceCard
                key={m.id}
                title={m.activity || "Untitled meetup"}
                sub={`${m.location ? `${m.location} · ` : ""}last on ${formatSlot(m.lastStartsAt)}`}
                selected={source === m.id}
                onPress={() => {
                  setSource(m.id);
                  applyPrefill(prefillFromMeetup(m));
                }}
              />
            ))}
          </>
        )}

        {stepKey === "activities" && (
          <>
            {activityChips.map((c) => (
              <Row key={c}>
                <Text style={{ flex: 1, fontFamily: font.bold, fontSize: 14, color: ui.ink }}>
                  {c}
                </Text>
                <TextButton
                  label="×"
                  tone="muted"
                  onPress={() => setActivityChips((cs) => cs.filter((x) => x !== c))}
                />
              </Row>
            ))}
            <Field
              label="Add an activity"
              optional
              value={activityDraft}
              onChangeText={setActivityDraft}
              placeholder="bowling, the pub..."
              right={
                <TextButton
                  label="Add"
                  disabled={!activityDraft.trim()}
                  onPress={commitDraftActivity}
                />
              }
            />
            <CheckOption
              label="Lock the activity"
              sub={
                canLockActivity ? "The group can't add more activities" : "Add an activity first"
              }
              on={lockActivityEff}
              disabled={!canLockActivity}
              onToggle={() => setLockActivity((v) => !v)}
              style={{ marginTop: 16 }}
            />
          </>
        )}

        {stepKey === "times" && (
          <>
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
            <CheckOption
              label="Lock the times"
              sub={canLockTimes ? "The group can't add more times" : "Add a time first"}
              on={lockTimesEff}
              disabled={!canLockTimes}
              onToggle={() => setLockTimes((v) => !v)}
              style={{ marginTop: 16 }}
            />
          </>
        )}

        {stepKey === "details" && (
          <>
            <Field
              label="Location"
              optional
              value={location}
              onChangeText={setLocation}
              placeholder="TenPin Bexleyheath"
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
          </>
        )}

        {stepKey === "deadlines" && (
          <>
            {!isConcrete && (
              <DeadlineField
                heading="Decides by"
                editing={decidesEdit}
                date={decidesDate}
                time={decidesTime}
                onDate={setDecidesDate}
                onTime={setDecidesTime}
                minimumDate={new Date()}
                invalid={decidesInvalid}
                invalidNote="It has to decide at least an hour before your earliest time."
                defaultLine={
                  autoDecidesIso ? `Decides ${formatSlot(autoDecidesIso)}` : "A sensible deadline"
                }
                defaultSub={
                  autoDecidesIso ? NOTE_TOP_PICK : "Add times to set this, or we'll pick a horizon"
                }
                onEdit={autoDecidesIso ? startEditDecides : undefined}
                onUseDefault={() => {
                  setDecidesEdit(false);
                  setDecidesDate("");
                  setDecidesTime("");
                }}
              />
            )}

            {earliestMs != null && (
              <DeadlineField
                style={{ marginTop: isConcrete ? 0 : 18 }}
                heading="Reply by"
                editing={replyEdit}
                date={replyDate}
                time={replyTime}
                onDate={setReplyDate}
                onTime={setReplyTime}
                minimumDate={new Date(replyFloorMs)}
                maximumDate={new Date(earliestMs)}
                invalid={replyInvalid}
                invalidNote="Replies close after voting ends and no later than your earliest time."
                defaultLine={
                  autoReplyIso ? `Replies close ${formatSlot(autoReplyIso)}` : "A sensible deadline"
                }
                defaultSub="Blind until then, then it reveals who's in"
                onEdit={autoReplyIso ? startEditReply : undefined}
                onUseDefault={() => {
                  setReplyEdit(false);
                  setReplyDate("");
                  setReplyTime("");
                }}
              />
            )}
          </>
        )}

        {stepKey === "confirm" && (
          <Card>
            <Text style={{ fontFamily: font.bold, fontSize: 14, color: ui.ink, lineHeight: 21 }}>
              {confirmMirror({
                timeCount: timeIsos.length,
                activityCount,
                timeFixed: timeIsos.length === 1 && lockTimesEff,
                activityFixed: lockActivityEff && activityCount <= 1,
                firstTimeIso: timeIsos[0] ?? null,
              })}
            </Text>
            <AppText variant="caption" style={{ marginTop: 12, lineHeight: 18 }}>
              {NO_NAMES}
            </AppText>
          </Card>
        )}
      </Section>

      <Button
        label={nextLabel}
        variant="primary"
        disabled={!valid(stepKey) || busy}
        onPress={goNext}
        style={{ marginTop: 24 }}
      />
    </ScreenScroll>
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
            borderRadius: ui.rPill,
            borderWidth: 1.5,
            borderColor: ui.ink,
            backgroundColor: i <= index ? ui.ink : "transparent",
          }}
        />
      ))}
    </View>
  );
}

// A pickable card on the source step (start fresh, or a past meetup). Selection shows via SelectCheck.
function SourceCard({
  title,
  sub,
  selected,
  onPress,
}: {
  title: string;
  sub: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Card padding={14} onPress={onPress} style={{ marginBottom: 11 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <AppText variant="title">{title}</AppText>
          <AppText variant="caption" style={{ marginTop: 2 }}>
            {sub}
          </AppText>
        </View>
        <SelectCheck selected={selected} />
      </View>
    </Card>
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
        borderRadius: ui.rPill,
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

// One deadline editor (decides-by / reply-by): a heading over a default-mode Card (the chosen line +
// a sub + an optional "Change") or an edit-mode Card (a date/time pill + an optional invalid note + a
// "Use default"). The two deadlines on the deadlines step are the same shape, so they share this.
function DeadlineField({
  heading,
  editing,
  date,
  time,
  onDate,
  onTime,
  minimumDate,
  maximumDate,
  invalid,
  invalidNote,
  defaultLine,
  defaultSub,
  onEdit,
  onUseDefault,
  style,
}: {
  heading: string;
  editing: boolean;
  date: string;
  time: string;
  onDate: (t: string) => void;
  onTime: (t: string) => void;
  minimumDate: Date;
  maximumDate?: Date;
  invalid: boolean;
  invalidNote: string;
  defaultLine: string;
  defaultSub: string;
  onEdit?: () => void;
  onUseDefault: () => void;
  style?: ViewStyle;
}) {
  return (
    <View style={style}>
      <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{heading}</Text>
      {editing ? (
        <Card style={{ marginTop: 8 }}>
          <DateTimePill
            dateValue={date}
            timeValue={time}
            onDate={onDate}
            onTime={onTime}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
          />
          {invalid && (
            <AppText variant="caption" style={{ color: ui.brand, marginTop: 8 }}>
              {invalidNote}
            </AppText>
          )}
          <View style={{ flexDirection: "row", marginTop: 12 }}>
            <Button size="sm" variant="outline" label="Use default" onPress={onUseDefault} />
          </View>
        </Card>
      ) : (
        <Card style={{ marginTop: 8 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{defaultLine}</Text>
          <AppText variant="caption" style={{ marginTop: 3 }}>
            {defaultSub}
          </AppText>
          {onEdit && (
            <View style={{ flexDirection: "row", marginTop: 10 }}>
              <Button size="sm" variant="outline" label="Change" onPress={onEdit} />
            </View>
          )}
        </Card>
      )}
    </View>
  );
}

// The plain-English outcome mirror. Describes each axis by whether it is FIXED (locked to its
// candidates so there is nothing to vote on) or still being decided, so the preview matches what the
// server actually does. Both fixed => concrete (skip voting); otherwise the open axis is voted on.
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
  const when = timeFixed && firstTimeIso ? `It's on for ${formatSlot(firstTimeIso)}` : null;

  if (when) {
    if (activityFixed) {
      return activityCount === 1
        ? `${when}. Activity set - just say who's in.`
        : `${when}. Just say who's in.`;
    }
    return `${when}. The group picks what to do, then who's in.`;
  }

  const timePart =
    timeCount >= 1
      ? `Vote on ${timeCount} time${timeCount === 1 ? "" : "s"}`
      : "The group suggests times";
  const activityPart = activityFixed
    ? activityCount === 1
      ? " (activity set)"
      : ""
    : activityCount >= 1
      ? ` and ${activityCount} ${activityCount === 1 ? "activity" : "activities"}`
      : " and what to do";
  return `${timePart}${activityPart}, then who's in.`;
}
