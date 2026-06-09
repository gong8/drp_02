import type { UpdateEventInput } from "@bethere/shared";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import {
  COND_MODE,
  DIDNT_COME_TOGETHER,
  ERR_SAVE,
  NOTE_BLIND,
  NOTE_TOP_PICK,
  planLabel,
  statusLabel,
} from "../lib/copy";
import { clock12, dayUpper } from "../lib/format";
import { activeDeadline, deadlineMs, isLive, isTerminal, type Phase } from "../lib/status";
import type { RouterOutputs } from "../lib/trpc";
import { trpc } from "../lib/trpc";
import { useBusyAction } from "../lib/useBusyAction";
import { POLL_MS, TICK_MS, useLiveClock } from "../lib/useLiveClock";
import { font, ui } from "../theme";
import {
  AppText,
  BottomSheet,
  Button,
  Card,
  DetailError,
  Field,
  FieldLabel,
  PersonRow,
  ScreenHeader,
  ScreenLoading,
  ScreenScroll,
  Section,
  Segmented,
  SelectCheck,
  StatusPill,
  TextButton,
} from "../ui";
import { CollectingView, CountdownBanner, MomentView, RevealView } from "./event-detail/PhaseViews";

type Detail = NonNullable<RouterOutputs["events"]["get"]>;
type Member = Detail["members"][number];
type CondModeLabel = (typeof COND_MODE)[keyof typeof COND_MODE];
type Props = NativeStackScreenProps<MeetupsStackParams, "EventDetail">;

// Sentinel key for the in-flight-mutation poll guard, used by the opt-out toggle (which is not tied
// to a single candidate id) so a refetch cannot clobber its optimistic state.
const OPTOUT_PENDING = "__optout__";

export function EventDetail({ route, navigation }: Props) {
  const { eventId } = route.params;
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  // moment conditional sheet
  const [reanswering, setReanswering] = useState(false);
  const [condSheet, setCondSheet] = useState(false);
  const [condModeLabel, setCondModeLabel] = useState<CondModeLabel>(COND_MODE.any);
  const [condPicked, setCondPicked] = useState<string[]>([]);

  // Edit-details sheet (activity/location/notes). Anyone can edit while the plan is live; saves use a
  // per-field compare-and-set so a concurrent edit by someone else surfaces here instead of clobbering.
  const [editSheet, setEditSheet] = useState(false);
  const [editActivity, setEditActivity] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const phaseRef = useRef<string>("");
  // Keys that freeze poll-driven setData while an optimistic mutation is in flight: candidate ids for
  // in-flight toggleReaction calls, plus the OPTOUT_PENDING sentinel for the opt-out toggle (which is
  // not tied to a single candidate). While the set is non-empty, load() skips applying poll data so
  // optimistic chips/checkbox never flicker; the next clean poll reconciles the true public counts.
  const pollFreezeKeys = useRef<Set<string>>(new Set());

  const load = useCallback(() => {
    return trpc.events.get
      .query({ id: eventId })
      .then((d) => {
        if (d && pollFreezeKeys.current.size === 0) setData(d);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [eventId]);

  // Busy-guarded mutate-then-reload runner shared by lock/addCandidate/answer/changeAnswer.
  const runAction = useBusyAction({ busy, setBusy, setError, load });

  // The 1s ticker drives both live countdowns - the moment reveal countdown and the collecting
  // decidesBy countdown - so run it during either timed phase (predicate below: moment OR collecting).
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
        if (active && !isTerminal({ phase: phaseRef.current as Phase })) load();
      }, POLL_MS);
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
    pollFreezeKeys.current.add(candidateId);
    trpc.events.toggleReaction
      .mutate({ eventId, candidateId })
      .catch(() => setData(flip(prevOptedOut)))
      .finally(() => pollFreezeKeys.current.delete(candidateId));
  }

  // "Can't make it" - a reversible, private exit. Optimistic; tapping any candidate above rejoins
  // (server clears the opt-out on a reaction). Opting out clears your +1s server-side, so drop them
  // locally NOW too (otherwise your votes only fall away on the next 5s poll, which looks laggy).
  // Guard the poll with a sentinel so an in-flight refetch cannot clobber the optimistic state.
  function toggleOptOut() {
    const next = !(data?.iOptedOut ?? false);
    const prev = data;
    const clearMine = <T extends { mine: boolean; count: number }>(rows: T[]): T[] =>
      next ? rows.map((c) => (c.mine ? { ...c, mine: false, count: c.count - 1 } : c)) : rows;
    setData((d) =>
      d
        ? {
            ...d,
            iOptedOut: next,
            timeCandidates: clearMine(d.timeCandidates),
            activityCandidates: clearMine(d.activityCandidates),
          }
        : d,
    );
    pollFreezeKeys.current.add(OPTOUT_PENDING);
    trpc.events.setOptOut
      .mutate({ eventId, out: next })
      .catch(() => setData(prev))
      .finally(() => pollFreezeKeys.current.delete(OPTOUT_PENDING));
  }

  function lock(candidateId?: string) {
    return runAction(() =>
      trpc.events.lock.mutate(candidateId ? { eventId, candidateId } : { eventId }),
    );
  }

  // Add a candidate while collecting (server +1s it for the author); refetch so it shows. Kind-gated
  // server-side: a time when lockTimes / an activity when lockActivity is FORBIDDEN (UI hides the add).
  function addTime(startsAt: string) {
    return runAction(() => trpc.events.addCandidate.mutate({ eventId, kind: "time", startsAt }));
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
      setReanswering(false);
    });
  }

  // "Change" un-commits: it clears the response so the plan returns to Action Required until a new
  // answer is given, then reopens the choices.
  function changeAnswer() {
    return runAction(async () => {
      await trpc.events.unrespond.mutate({ eventId });
      setReanswering(true);
    });
  }

  // Open the edit sheet, prefilled from the loaded values. The name prefills from the RAW stored
  // activity (often ""), so an empty field means "keep auto-naming from the activity list" - the
  // placeholder shows the current activity so that intent reads clearly.
  function openEditSheet() {
    if (!data) return;
    setEditActivity(data.activityRaw);
    setEditLocation(data.location);
    setEditNotes(data.description ?? "");
    setEditMessage("");
    setEditSheet(true);
  }

  // Save edits with a per-field compare-and-set: send only the fields whose input diverged from what
  // we loaded, each as { from: loaded, to: typed }. The server writes a field only if its current DB
  // value still equals `from`. If something changed under us, `conflicts` carries the now-current
  // value: we adopt it into the input AND advance the local baseline to that value (so a second save
  // sends from=current and can actually win, instead of re-conflicting in a loop), keep the sheet
  // open, and ask the user to review. Whenever anything applied we also reload so the applied fields
  // show fresh values immediately rather than waiting for the next poll. A throw (e.g. the plan just
  // went final) shows an inline error and refetches so the screen reflects reality.
  function saveEdit() {
    if (!data || savingEdit) return;
    // One descriptor list is the single source of truth for the editable-field set, driving the
    // per-field diff below, the conflict-adopt input state via `set`, and the local-baseline adopt
    // via `applyToData`. The `as const` keys keep `patch` typed against UpdateEventInput's optional
    // activity/location/description keys.
    const fields = [
      {
        key: "activity" as const,
        loaded: data.activityRaw,
        value: editActivity,
        set: setEditActivity,
        applyToData: (d: Detail, v: string) => {
          d.activityRaw = v;
        },
      },
      {
        key: "location" as const,
        loaded: data.location,
        value: editLocation,
        set: setEditLocation,
        applyToData: (d: Detail, v: string) => {
          d.location = v;
        },
      },
      {
        key: "description" as const,
        loaded: data.description ?? "",
        value: editNotes,
        set: setEditNotes,
        applyToData: (d: Detail, v: string) => {
          d.description = v;
        },
      },
    ];
    const patch: Pick<UpdateEventInput, "activity" | "location" | "description"> = {};
    for (const f of fields)
      if (f.value !== f.loaded) patch[f.key] = { from: f.loaded, to: f.value };
    // Nothing changed - just close.
    if (Object.keys(patch).length === 0) {
      setEditSheet(false);
      return;
    }
    setSavingEdit(true);
    setEditMessage("");
    trpc.events.update
      .mutate({ eventId: data.id, ...patch })
      .then((res) => {
        if (res.conflicts.length === 0) {
          setEditSheet(false);
          return load();
        }
        // Adopt the server's current value for each conflicted field, advancing both the input state
        // (`set`) and the local baseline (`applyToData`) via the one descriptor list so the next save
        // sends from=current (otherwise a second save re-sends the stale `from` and conflicts forever),
        // and keep the sheet open. An unknown conflict field is silently skipped.
        setData((d) => {
          if (!d) return d;
          const next = { ...d };
          for (const c of res.conflicts) {
            const f = fields.find((f) => f.key === c.field);
            if (!f) continue;
            f.set(c.current);
            f.applyToData(next, c.current);
          }
          return next;
        });
        setEditMessage("Updated by someone else - review and save again.");
        // A partial save (some fields applied, the rest conflicted) leaves the applied fields stale
        // in `data` until the next poll, so reload to surface them now while the sheet stays open.
        if (res.applied.length > 0) return load();
      })
      .catch(() => {
        setEditMessage(`${ERR_SAVE} This meetup may have closed.`);
        return load();
      })
      .finally(() => setSavingEdit(false));
  }

  if (loading) return <ScreenLoading />;
  if (error || !data)
    return (
      <DetailError
        error={error}
        onBack={() => navigation.goBack()}
        notFoundLabel="Meetup not found."
      />
    );

  // The live phase's ms-to-deadline + label; the two CountdownBanners below are mutually exclusive by
  // phase, and activeDeadline owns the same phase->label mapping the dashboard cards consume.
  const ms = deadlineMs(data, now);
  const { label } = activeDeadline(data);
  const activityEditable = data.phase === "moment" || data.phase === "cleared";

  const sheets = (
    <>
      <BottomSheet visible={condSheet} onClose={() => setCondSheet(false)}>
        <Section title="Go if these people are in" size="lg" />
        <Segmented
          options={[COND_MODE.any, COND_MODE.all] as const}
          value={condModeLabel}
          onChange={setCondModeLabel}
          variant="bar"
        />
        <View style={{ marginTop: 12, marginBottom: 4 }}>
          {data.members.map((m: Member) => {
            const on = condPicked.includes(m.id);
            return (
              <PersonRow
                key={m.id}
                name={m.name}
                color={ui.muted}
                index={0}
                divided={false}
                padding={9}
                onPress={() =>
                  setCondPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))
                }
                right={<SelectCheck selected={on} />}
              />
            );
          })}
          {data.members.length === 0 && (
            <AppText variant="caption">No one else in this group.</AppText>
          )}
        </View>
        <Button
          label="Confirm"
          variant="primary"
          disabled={!condPicked.length || busy}
          onPress={() => {
            setCondSheet(false);
            answer("conditional", {
              mode: condModeLabel === COND_MODE.all ? "all" : "any",
              targetIds: condPicked,
            });
          }}
          style={{ marginTop: 12 }}
        />
      </BottomSheet>

      <BottomSheet visible={editSheet} onClose={() => setEditSheet(false)}>
        <Section title="Edit details" size="lg" />
        {activityEditable && (
          <Field
            label="Activity"
            optional
            value={editActivity}
            onChangeText={setEditActivity}
            placeholder={data.activity}
          />
        )}
        <Field
          label="Location"
          optional
          value={editLocation}
          onChangeText={setEditLocation}
          placeholder="TenPin Bexleyheath"
          style={{ marginTop: activityEditable ? 12 : 0 }}
        />
        <Field
          label="Notes"
          optional
          value={editNotes}
          onChangeText={setEditNotes}
          placeholder="Come at 6, we'll eat around 8"
          multiline
          style={{ marginTop: 12 }}
        />
        {editMessage ? (
          <AppText variant="caption" style={{ color: ui.brand, marginTop: 12, lineHeight: 16 }}>
            {editMessage}
          </AppText>
        ) : null}
        <Button
          label="Save"
          variant="primary"
          disabled={savingEdit}
          onPress={saveEdit}
          style={{ marginTop: 14 }}
        />
      </BottomSheet>
    </>
  );

  return (
    <ScreenScroll
      header={<ScreenHeader title={data.activity || "Meetup"} onBack={() => navigation.goBack()} />}
      bottomPad={28}
      footer={sheets}
    >
      {data.phase === "collecting" && data.decidesBy && (
        <CountdownBanner label={label} ms={ms} note={NOTE_TOP_PICK} />
      )}
      {data.phase === "moment" && <CountdownBanner label={label} ms={ms} note={NOTE_BLIND} />}

      <PlanHeaderCard data={data} canEdit={isLive(data)} onEdit={openEditSheet} />

      {data.phase === "collecting" && (
        <CollectingView
          data={data}
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
          reanswering={reanswering}
          onChangeAnswer={changeAnswer}
          statusLine={statusLabel(data.myStatus)}
          onYes={() => answer("yes")}
          onNo={() => answer("no")}
          onConditional={() => {
            setCondPicked([]);
            setCondSheet(true);
          }}
        />
      )}

      {data.phase === "cleared" && (
        <RevealView data={data} statusLine={statusLabel(data.myStatus)} />
      )}

      {data.phase === "fizzled" && (
        <View style={{ marginTop: 16 }}>
          <Card>
            <AppText variant="cardTitle">{DIDNT_COME_TOGETHER}</AppText>
            <AppText variant="captionPara" style={{ marginTop: 6 }}>
              Not enough people in. Suggest another anytime.
            </AppText>
          </Card>
        </View>
      )}
    </ScreenScroll>
  );
}

// The plan's header card: a chosen-time hero banner once a slot is locked (moment/cleared; collecting
// has no single time yet), then the plan title, group/location line, notes, and an Edit affordance.
function PlanHeaderCard({
  data,
  canEdit,
  onEdit,
}: {
  data: Detail;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const heroIso = data.chosenStartsAt && data.phase !== "collecting" ? data.chosenStartsAt : null;
  const heroClock = heroIso ? clock12(heroIso) : null;
  return (
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
            <FieldLabel tone="muted" style={{ letterSpacing: 1 }}>
              {dayUpper(heroIso)}
            </FieldLabel>
            <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 3 }}>
              <Text
                style={{ fontFamily: font.display, fontSize: 34, lineHeight: 36, color: ui.ink }}
              >
                {heroClock.time}
              </Text>
              <Text
                style={{
                  fontFamily: font.bold,
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
          {data.phase === "cleared" ? <StatusPill label="It's on" /> : null}
        </View>
      ) : null}
      <View style={{ paddingHorizontal: 16, paddingTop: heroIso ? 14 : 16, paddingBottom: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <Text
            style={{
              flex: 1,
              fontFamily: font.display,
              fontSize: 24,
              letterSpacing: -0.5,
              color: ui.ink,
            }}
          >
            {planLabel(data)}
          </Text>
          {canEdit && (
            <TextButton
              label="Edit"
              onPress={onEdit}
              style={{ fontSize: 12, marginLeft: 10, marginTop: 4 }}
            />
          )}
        </View>
        <AppText variant="caption" style={{ marginTop: 4 }}>
          {data.groupName}
          {data.location ? ` · ${data.location}` : ""}
        </AppText>
        {data.description ? (
          <AppText variant="captionPara" style={{ marginTop: 8 }}>
            {data.description}
          </AppText>
        ) : null}
      </View>
    </Card>
  );
}
