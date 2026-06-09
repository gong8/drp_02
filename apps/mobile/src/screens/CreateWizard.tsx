import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import type { MeetupsStackParams } from "../../App";
import {
  ACTION_NEW_GROUP,
  ANON_SEND_BODY,
  ANON_SEND_TITLE,
  DEADLINE_VOTING,
  ERR_SAVE,
  LABEL_GROUP_NAME,
  NOTE_TOP_PICK,
  plural,
  STEP_COPY,
  TITLE_NEW_GROUP,
  TITLE_NEW_MEETUP,
} from "../lib/copy";
import { formatSlot, isoFrom, splitIso } from "../lib/format";
import { defaultDecidesByForCandidates, defaultReplyByMs, MOMENT_MS } from "../lib/lock";
import {
  EMPTY_PREFILL,
  type Prefill,
  prefillFromMeetup,
  type StepKey,
  wizardSteps,
} from "../lib/redo";
import type { RouterOutputs } from "../lib/trpc";
import { trpc } from "../lib/trpc";
import { ui } from "../theme";
import {
  AppText,
  BottomSheet,
  Button,
  Card,
  CheckOption,
  Chip,
  DateTimePill,
  Field,
  FieldLabel,
  FormError,
  Row,
  ScreenHeader,
  ScreenLoading,
  ScreenScroll,
  Section,
  SelectCheck,
  TextButton,
} from "../ui";

type Group = RouterOutputs["groups"]["mine"][number];
type PastMeetup = RouterOutputs["events"]["pastForGroup"][number];
type TimeRow = { id: string; date: string; time: string };
type Props = NativeStackScreenProps<MeetupsStackParams, "CreateWizard">;

export function CreateWizard({ navigation }: Props) {
  const [step, setStep] = useState(0);

  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  // Inline "create a group" without leaving the meetup flow (the group step's "+ New group" chip):
  // creating one appends it to the list and selects it, so the wizard continues with it preselected.
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [pastMeetups, setPastMeetups] = useState<PastMeetup[]>([]);
  // Whether the past-meetups query for the current group has settled. The "source" step is inserted
  // only once it has, so the group step gates Next on this - otherwise a late insert would shift the
  // step list under the user (stepKey is an index) and silently change the visible step.
  const [pastLoaded, setPastLoaded] = useState(false);
  // The source-step choice: null = not chosen yet, "fresh" = start blank, otherwise a past-meetup id.
  const [source, setSource] = useState<"fresh" | string | null>(null);

  const steps = wizardSteps(pastMeetups.length > 0);
  const stepKey = steps[step];
  const isLastStep = step === steps.length - 1;
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  // Activity ("what") candidates - ideas, optional, no names ever shown.
  const [activityChips, setActivityChips] = useState<string[]>([]);
  const [activityDraft, setActivityDraft] = useState("");
  // Time candidates - concrete multi-row date/time rows, optional.
  const [timeRows, setTimeRows] = useState<TimeRow[]>([{ id: "t0", date: "", time: "" }]);
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

  const updateTimeRow = (id: string, patch: Partial<TimeRow>) =>
    setTimeRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Stable across renders (only touches state setters and a ref), so the group-change effect can list
  // it as a dependency without re-running on every render.
  const applyPrefill = useCallback((p: Prefill) => {
    setActivityChips(p.activityChips);
    setActivityDraft("");
    setLockTimes(p.lockTimes);
    setLockActivity(p.lockActivity);
    setLocation(p.location);
    setNotes(p.description);
    // Time is never carried - reset to a single blank row so the creator sets it fresh.
    setTimeRows([{ id: "t0", date: "", time: "" }]);
    nextRowId.current = 1;
    setDecidesEdit(false);
    setReplyEdit(false);
  }, []);

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
  // group (the source step is only meaningful for the currently selected group). applyPrefill is
  // useCallback-stable, so effectively this re-runs only when groupId changes.
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
  }, [groupId, applyPrefill]);

  // Dedupe by minute exactly as the server does (events.create collapses same-minute candidates,
  // keeping the first), so the preview count / isConcrete / confirm mirror and the submit payload all
  // match what the server actually stores - a slot sent twice in one minute must count once.
  const seenTimeMinutes = new Set<number>();
  const timeIsos = timeRows
    .map((r) => isoFrom(r.date, r.time))
    .filter((x): x is string => x !== null)
    .filter((iso) => {
      const minute = Math.floor(new Date(iso).getTime() / 60_000);
      if (seenTimeMinutes.has(minute)) return false;
      seenTimeMinutes.add(minute);
      return true;
    });
  const earliestMs = timeIsos.length
    ? Math.min(...timeIsos.map((iso) => new Date(iso).getTime()))
    : null;
  const autoDecidesIso =
    earliestMs != null
      ? new Date(defaultDecidesByForCandidates(earliestMs, Date.now())).toISOString()
      : null;
  const summaryActivities = activityChips.concat(
    activityDraft.trim() ? [activityDraft.trim()] : [],
  );
  const activityCount = summaryActivities.length;
  // You can only lock an axis that has something on it (you can't fix nothing). A lock with no
  // candidate is ignored, so the checkbox is disabled until at least one exists.
  const canLockTimes = timeIsos.length > 0;
  const canLockActivity = activityCount > 0;
  const lockTimesEff = lockTimes && canLockTimes;
  const lockActivityEff = lockActivity && canLockActivity;
  const timeFixed = timeIsos.length === 1 && lockTimesEff;
  const activityFixed = lockActivityEff && activityCount <= 1;
  // Concrete shortcut: skip voting only when BOTH axes are pinned - one locked time AND a locked
  // activity. Must match the server's planOpensMoment so the preview never diverges.
  const isConcrete = timeFixed && activityFixed;

  const decidesOverrideIso = decidesEdit ? isoFrom(decidesDate, decidesTime) : null;
  // Match the server bounds (events.create): a custom deadline must sit after now AND leave a full
  // moment of headroom before the earliest time, not just land before it - otherwise submit fails
  // server-side. A concrete plan has no decides-by field, so a stale decidesEdit value left over from
  // before the plan became concrete must not count toward validity (the !isConcrete guard) - otherwise
  // it would permanently disable Next/Send with no way for the user to clear it.
  const decidesPastNow =
    !!decidesOverrideIso && new Date(decidesOverrideIso).getTime() <= Date.now();
  const decidesTooLate =
    !!decidesOverrideIso &&
    earliestMs != null &&
    new Date(decidesOverrideIso).getTime() > earliestMs - MOMENT_MS;
  const decidesInvalid = !isConcrete && (decidesPastNow || decidesTooLate);
  // A concrete plan has no decides-by (the server ignores it), so never send one - this also stops a
  // stale decidesEdit value (left from before the plan became concrete) leaking onto the wire.
  const decidesToSend =
    !isConcrete && decidesEdit && decidesOverrideIso && !decidesInvalid
      ? decidesOverrideIso
      : undefined;

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

  // Confirm-step summary: the plain-English readback of exactly what will be sent. Drawn from the
  // same derived values the submit payload uses, so the summary can never claim something the create
  // call won't do. Each axis reports its candidates plus whether it is locked (fixed) or open to the
  // group; the deadlines mirror decidesToSend/replyToSend (or the shown defaults).
  const groupName = groups.find((g) => g.id === groupId)?.name ?? "";
  const summaryTimes = timeIsos.map(formatSlot);
  const decidesShown = !isConcrete ? (decidesToSend ?? autoDecidesIso) : null;
  // reply-by (unlike decides-by) already bakes its default into replyToSend, so no fallback here.
  const replyShown = replyToSend;
  const replyLine = replyShown ? `Replies close ${formatSlot(replyShown)}` : null;
  const deadlineLines = isConcrete
    ? [replyLine ?? "We'll pick a sensible deadline"]
    : earliestMs == null
      ? ["Set once there's a time on the table"]
      : [
          ...(decidesShown ? [`${DEADLINE_VOTING} ${formatSlot(decidesShown)}`] : []),
          ...(replyLine ? [replyLine] : []),
        ];

  function canAdvance(key: StepKey): boolean {
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

  // Fold the typed-but-not-added activity into the chip list (case-insensitive de-dup), returning
  // the resulting set so submit can use it synchronously.
  function commitDraftActivity(): string[] {
    const t = activityDraft.trim();
    if (!t) return activityChips;
    // The shared schema caps activityCandidates at 10, so refuse an 11th here (mirroring the times
    // cap) - otherwise create fails server-side with a generic error.
    if (activityChips.length >= 10) return activityChips;
    setActivityDraft("");
    if (activityChips.some((c) => c.toLowerCase() === t.toLowerCase())) return activityChips;
    const next = [...activityChips, t];
    setActivityChips(next);
    return next;
  }

  // Both deadlines run the same edit/reset machinery: seed the date/time pill from the shown default
  // when starting an edit, and clear back to the default when reset. The only things that vary are
  // which auto ISO seeds the edit and which four state setters are written, so build one factory.
  const decidesHandlers = makeDeadlineHandlers(
    autoDecidesIso,
    setDecidesEdit,
    setDecidesDate,
    setDecidesTime,
  );
  const replyHandlers = makeDeadlineHandlers(
    autoReplyIso,
    setReplyEdit,
    setReplyDate,
    setReplyTime,
  );

  async function submit() {
    if (busy || !groupId) return;
    setBusy(true);
    const activities = commitDraftActivity();
    try {
      const created = await trpc.events.create.mutate({
        groupId,
        description: notes.trim() || undefined,
        location: location.trim() || undefined,
        timeCandidates: timeIsos.map((startsAt) => ({ startsAt })),
        activityCandidates: activities.length ? activities : undefined,
        lockTimes: lockTimesEff,
        lockActivity: lockActivityEff,
        decidesBy: decidesToSend,
        replyBy: replyToSend,
      });
      // Land on the new plan with the share sheet auto-opening (create-the-meetup-first ->
      // share-one-link); back from it lands on the dashboard, not this spent wizard.
      navigation.reset({
        index: 1,
        routes: [
          { name: "Dashboard" },
          { name: "EventDetail", params: { eventId: created.id, shareOnLand: true } },
        ],
      });
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  // Create a group inline from the group step, then select it (no navigation away - the wizard state
  // is preserved). Setting groupId triggers the group-change effect, which loads the new group's (empty)
  // redo list and resolves pastLoaded so the step can advance.
  async function createNewGroup() {
    const trimmed = newGroupName.trim();
    if (!trimmed || creatingGroup) return;
    setCreatingGroup(true);
    try {
      const res = await trpc.groups.create.mutate({ name: trimmed });
      setGroups((gs) => [...gs, { id: res.id, name: trimmed, memberCount: 1 }]);
      setGroupId(res.id);
      setNewGroupName("");
      setNewGroupOpen(false);
    } catch {
      setError(true);
    } finally {
      setCreatingGroup(false);
    }
  }

  function goNext() {
    if (!canGoNext || busy) return;
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
  const stepCopy = STEP_COPY[stepKey];
  const canGoNext = canAdvance(stepKey);

  return (
    <ScreenScroll header={<ScreenHeader title={TITLE_NEW_MEETUP} onBack={goBack} />} avoidKeyboard>
      <ProgressDots steps={steps} index={step} />
      {error && <FormError>{ERR_SAVE}</FormError>}

      <Section title={stepCopy.title} sub={stepCopy.sub} size="lg">
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
            <Chip label={ACTION_NEW_GROUP} selected={false} onPress={() => setNewGroupOpen(true)} />
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
                <AppText variant="rowLabel" style={{ flex: 1 }}>
                  {c}
                </AppText>
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
                  disabled={!activityDraft.trim() || activityChips.length >= 10}
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
            {timeRows.map((r) => (
              <View key={r.id} style={{ position: "relative", marginBottom: 10 }}>
                <DateTimePill
                  dateValue={r.date}
                  timeValue={r.time}
                  onDate={(t) => updateTimeRow(r.id, { date: t })}
                  onTime={(t) => updateTimeRow(r.id, { time: t })}
                  minimumDate={new Date()}
                />
                {timeRows.length > 1 && (
                  <RemoveDot onPress={() => setTimeRows((rs) => rs.filter((x) => x.id !== r.id))} />
                )}
              </View>
            ))}
            {timeRows.length < 10 && (
              <Chip
                label="+ Add a time"
                onPress={() =>
                  setTimeRows((rs) => [
                    ...rs,
                    { id: `t${nextRowId.current++}`, date: "", time: "" },
                  ])
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
              value={notes}
              onChangeText={setNotes}
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
                invalidNote={
                  decidesPastNow
                    ? "The deadline has to be in the future."
                    : "It has to decide at least an hour before your earliest time."
                }
                defaultLine={
                  autoDecidesIso ? `Decides ${formatSlot(autoDecidesIso)}` : "A sensible deadline"
                }
                defaultSub={
                  autoDecidesIso ? NOTE_TOP_PICK : "Add times to set this, or we'll pick a horizon"
                }
                onEdit={autoDecidesIso ? decidesHandlers.startEdit : undefined}
                onUseDefault={decidesHandlers.useDefault}
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
                onEdit={autoReplyIso ? replyHandlers.startEdit : undefined}
                onUseDefault={replyHandlers.useDefault}
              />
            )}
          </>
        )}

        {stepKey === "confirm" && (
          <Card padding={0}>
            <SummaryItem first label="Group" lines={[groupName || "No group"]} muted={!groupName} />
            <SummaryItem
              label="What"
              lines={summaryActivities.length ? summaryActivities : ["Open - the group adds ideas"]}
              muted={summaryActivities.length === 0}
              note={axisNote(summaryActivities.length > 0, lockActivityEff)}
            />
            <SummaryItem
              label="When"
              lines={summaryTimes.length ? summaryTimes : ["Open - the group adds times"]}
              muted={summaryTimes.length === 0}
              note={axisNote(summaryTimes.length > 0, lockTimesEff)}
            />
            {location.trim() ? <SummaryItem label="Where" lines={[location.trim()]} /> : null}
            {notes.trim() ? <SummaryItem label="Notes" lines={[notes.trim()]} /> : null}
            <SummaryItem label="Deadlines" lines={deadlineLines} />

            <View
              style={{
                borderTopWidth: ui.border,
                borderTopColor: ui.ink,
                backgroundColor: ui.tint,
                paddingHorizontal: 14,
                paddingVertical: 13,
              }}
            >
              <AppText variant="rowLabelSm" style={{ lineHeight: 19 }}>
                {outcomeSummary({
                  timeCount: timeIsos.length,
                  activityCount,
                  timeFixed,
                  activityFixed,
                  firstTimeIso: timeIsos[0] ?? null,
                })}
              </AppText>
              <View
                style={{ height: 1, backgroundColor: ui.hairline, marginTop: 12, marginBottom: 11 }}
              />
              <FieldLabel tone="muted">{ANON_SEND_TITLE}</FieldLabel>
              <AppText variant="caption" style={{ marginTop: 4, lineHeight: 16 }}>
                {ANON_SEND_BODY}
              </AppText>
            </View>
          </Card>
        )}
      </Section>

      <Button
        label={nextLabel}
        variant="primary"
        disabled={!canGoNext || busy}
        onPress={goNext}
        style={{ marginTop: 24 }}
      />

      <BottomSheet visible={newGroupOpen} onClose={() => setNewGroupOpen(false)}>
        <Section title={TITLE_NEW_GROUP} size="lg" />
        <Field
          label={LABEL_GROUP_NAME}
          value={newGroupName}
          onChangeText={setNewGroupName}
          placeholder="The Boys"
        />
        <Button
          label="Create group"
          variant="primary"
          disabled={newGroupName.trim() === "" || creatingGroup}
          onPress={createNewGroup}
          style={{ marginTop: 16 }}
        />
      </BottomSheet>
    </ScreenScroll>
  );
}

// Confirm-step note shown under a What/When SummaryItem: nothing when the axis has no candidates,
// otherwise whether the group can still add to that list.
function axisNote(hasCandidates: boolean, locked: boolean): string | undefined {
  if (!hasCandidates) return undefined;
  return locked ? "Locked - the group can't add more" : "Open - the group can add more and vote";
}

// The shared edit/reset handlers for one deadline editor (decides-by / reply-by). startEdit seeds the
// date/time pill from the shown default (so editing begins from what the user saw) then enables edit
// mode; useDefault clears back to the default. The two deadlines differ only in their auto ISO and
// their four state setters, so both are built from this one factory.
function makeDeadlineHandlers(
  autoIso: string | null,
  setEdit: (b: boolean) => void,
  setDate: (t: string) => void,
  setTime: (t: string) => void,
) {
  return {
    startEdit() {
      if (autoIso) {
        const { date, time } = splitIso(autoIso);
        setDate(date);
        setTime(time);
      }
      setEdit(true);
    },
    useDefault() {
      setEdit(false);
      setDate("");
      setTime("");
    },
  };
}

function ProgressDots({ steps, index }: { steps: readonly StepKey[]; index: number }) {
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

// One labelled line of the "Ready to send?" readback: a muted overline over one or more value lines
// (multi-line for a vote list of times/activities), with an optional caption note (e.g. "Locked").
// Stacked inside a padding-0 Card and divided by hairlines, the items read as a quiet summary table -
// the EventDetail info-card language - not a stack of pressables.
function SummaryItem({
  label,
  lines,
  note,
  muted = false,
  first = false,
}: {
  label: string;
  lines: string[];
  note?: string;
  muted?: boolean;
  first?: boolean;
}) {
  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: ui.hairline,
      }}
    >
      <FieldLabel tone="muted">{label}</FieldLabel>
      <View style={{ marginTop: 5 }}>
        {lines.map((l) => (
          <AppText key={l} variant="rowLabel" style={muted ? { color: ui.muted } : undefined}>
            {l}
          </AppText>
        ))}
        {note ? (
          <AppText variant="caption" style={{ marginTop: 3 }}>
            {note}
          </AppText>
        ) : null}
      </View>
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
        borderRadius: ui.rPill,
        backgroundColor: ui.surface,
        borderWidth: ui.border,
        borderColor: ui.ink,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AppText variant="rowLabelSm" style={{ lineHeight: 13 }}>
        ×
      </AppText>
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
      <AppText variant="rowLabelSm">{heading}</AppText>
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
          <AppText variant="rowLabelSm">{defaultLine}</AppText>
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
function outcomeSummary({
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

  // activityFixed implies exactly one activity (lockActivityEff implies activityCount > 0).
  if (when) {
    if (activityFixed) return `${when}. Activity set - just say who's in.`;
    return `${when}. The group picks what to do, then who's in.`;
  }

  const timePart =
    timeCount >= 1
      ? `Vote on ${timeCount} ${plural(timeCount, "time")}`
      : "The group suggests times";
  const activityPart = activityFixed
    ? " (activity set)"
    : activityCount >= 1
      ? ` and ${activityCount} ${plural(activityCount, "activity", "activities")}`
      : " and what to do";
  return `${timePart}${activityPart}, then who's in.`;
}
