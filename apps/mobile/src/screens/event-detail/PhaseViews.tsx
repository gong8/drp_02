import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { LABEL_CANT_MAKE_IT, NO_NAMES } from "../../lib/copy";
import { formatSlot, isoFrom, partOfDayLabel } from "../../lib/format";
import { addCandidateHorizon } from "../../lib/lock";
import { font, ui } from "../../theme";
import {
  AddComposer,
  AppText,
  Band,
  Button,
  Card,
  CheckOption,
  Countdown,
  DateTimePill,
  Field,
  FieldLabel,
  PersonRow,
  Row,
  Section,
  SelectCheck,
} from "../../ui";
import type { ActivityCand, Detail, TimeCand } from "./types";

// The committed-answer / outcome status line, shared by the moment locked-in view and the reveal.
function StatusHeading({ children }: { children: string }) {
  return (
    <AppText variant="rowLabel" style={{ marginBottom: 12 }}>
      {children}
    </AppText>
  );
}

// A full-bleed countdown banner for the time-pressured phases (the collecting deadline and the
// moment reveal). The duration is the loud element; `note` is a one-word tag on the right.
export function CountdownBanner({ label, ms, note }: { label: string; ms: number; note: string }) {
  return (
    <Band style={{ marginTop: -2, marginBottom: 14, flexDirection: "row", alignItems: "center" }}>
      <View style={{ flex: 1 }}>
        <Countdown ms={ms} label={label} color={ui.onInk} big />
      </View>
      <Text
        style={{
          fontFamily: font.bold,
          fontSize: 11,
          color: ui.onInk,
          opacity: 0.92,
          marginLeft: 12,
        }}
      >
        {note}
      </Text>
    </Band>
  );
}

// Collecting: PUBLIC vote board. Two candidate lists - ACTIVITY (what) and TIME (when) - each a table
// of rows with a checkbox (the caller's own +1) and the public count. The add control is the SAME
// composer for both lists; it is hidden when the creator locked that axis. No names ever shown.
export function CollectingView({
  data,
  busy,
  onToggleReaction,
  onToggleOptOut,
  onLock,
  onAddTime,
  onAddActivity,
  onComposingChange,
}: {
  data: Detail;
  busy: boolean;
  onToggleReaction: (candidateId: string) => void;
  onToggleOptOut: () => void;
  onLock: (candidateId?: string) => void;
  onAddTime: (startsAt: string) => void;
  onAddActivity: (text: string) => void;
  // Reports whether either inline add-composer (time or activity) is open, so the screen can hide a
  // sticky CTA while the user is mid-compose.
  onComposingChange?: (composing: boolean) => void;
}) {
  const [timeOpen, setTimeOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  useEffect(() => {
    onComposingChange?.(timeOpen || activityOpen);
  }, [timeOpen, activityOpen, onComposingChange]);
  return (
    <View style={{ marginTop: 16 }}>
      {(data.activityCandidates.length > 0 || !data.lockActivity) && (
        <Section title="What">
          {data.activityCandidates.map((c: ActivityCand) => (
            <VoteRow
              key={c.id}
              label={c.text}
              count={c.count}
              mine={c.mine}
              onPress={() => onToggleReaction(c.id)}
            />
          ))}
          {!data.lockActivity && (
            <AddActivity busy={busy} onAdd={onAddActivity} onToggle={setActivityOpen} />
          )}
        </Section>
      )}

      {(data.timeCandidates.length > 0 || !data.lockTimes) && (
        <Section title="When">
          {data.timeCandidates.map((c: TimeCand) => (
            <VoteRow
              key={c.id}
              label={timeRowLabel(c)}
              count={c.count}
              mine={c.mine}
              onPress={() => onToggleReaction(c.id)}
            />
          ))}
          {!data.lockTimes && (
            <AddTime busy={busy} data={data} onAdd={onAddTime} onToggle={setTimeOpen} />
          )}
        </Section>
      )}

      <CheckOption
        label={LABEL_CANT_MAKE_IT}
        sub="Tap anything above to rejoin"
        on={data.iOptedOut}
        onToggle={onToggleOptOut}
        accent={ui.ink}
        tinted
      />

      <AppText variant="caption" style={{ textAlign: "center", marginTop: 16 }}>
        {NO_NAMES}
      </AppText>

      {/* No manual lock for members (pure deadline); this dev-only button forces it for demos. Needs
          at least one time candidate to lock onto - otherwise the server rejects it. */}
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
function timeRowLabel(c: TimeCand): string {
  const slot = formatSlot(c.startsAt);
  return c.partOfDay ? `${slot} · ${partOfDayLabel(c.partOfDay)}` : slot;
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
    <Row onPress={onPress} tinted={mine}>
      <SelectCheck selected={mine} />
      <AppText variant="rowLabel" style={{ flex: 1 }}>
        {label}
      </AppText>
      <Text
        style={{
          fontFamily: font.bold,
          fontSize: 12,
          color: ui.muted,
          fontVariant: ["tabular-nums"],
        }}
      >
        {count}
      </Text>
    </Row>
  );
}

// Inline free-text activity entry through the shared AddComposer (one add affordance for both lists).
function AddActivity({
  busy,
  onAdd,
  onToggle,
}: {
  busy: boolean;
  onAdd: (text: string) => void;
  onToggle?: (open: boolean) => void;
}) {
  const [text, setText] = useState("");
  return (
    <AddComposer
      triggerLabel="+ add an activity"
      busy={busy}
      canSubmit={!!text.trim()}
      onToggle={onToggle}
      onSubmit={() => {
        const t = text.trim();
        if (t) onAdd(t);
        setText("");
      }}
      onCancel={() => setText("")}
    >
      <Field
        label="Activity"
        value={text}
        onChangeText={setText}
        placeholder="bowling, the pub..."
      />
    </AddComposer>
  );
}

// Picker bounds for the DATE half of the add-a-time pill, derived from the existing candidate spread
// and decides-by. minMs is the earliest a new time may land (now, or the vote close); maxMs the latest
// (the candidate horizon, or a 14-day fallback before any time exists). `closed` is true when that
// window has fully elapsed (horizon at/under the floor) - e.g. a collecting plan whose every candidate
// is already in the past (stale demo data). In that state there is no valid time to add AND the raw
// bounds would invert (min > max); maxMs is held at minMs so the bounds can never invert, and callers
// MUST NOT open the picker (an inverted minimumDate/maximumDate hard-crashes the native picker).
export function addTimeWindow(
  startsAtIso: string[],
  decidesByIso: string | null,
  nowMs: number,
): { minMs: number; maxMs: number; closed: boolean } {
  const times = startsAtIso.map((iso) => new Date(iso).getTime());
  const decideMs = decidesByIso ? new Date(decidesByIso).getTime() : nowMs;
  const horizonMs = times.length
    ? addCandidateHorizon(Math.min(...times), Math.max(...times))
    : null;
  const minMs = Math.max(nowMs, decideMs);
  const rawMaxMs = horizonMs ?? decideMs + 14 * 24 * 60 * 60 * 1000;
  // Held at minMs (never below) so the DATE picker's bounds can never invert; `closed` tells the
  // composer to refuse to open the picker at all when there is no longer a usable slot.
  return { minMs, maxMs: Math.max(minMs, rawMaxMs), closed: rawMaxMs <= minMs };
}

// Inline concrete time entry through the shared AddComposer, bounded to a sensible horizon from the
// existing candidate spread. De-duped by minute server-side. The pill's min/max only bound the DATE
// half - the combined date+time can still land outside the server's accept window (after decides-by,
// within the horizon), e.g. the minimum date with a clock time before the deadline's. So mirror the
// server's two reject rules (events.addCandidate) here: an out-of-range pick disables Add and names
// the actual boundary, instead of submitting and failing.
function AddTime({
  busy,
  data,
  onAdd,
  onToggle,
}: {
  busy: boolean;
  data: Detail;
  onAdd: (startsAt: string) => void;
  onToggle?: (open: boolean) => void;
}) {
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const newIso = isoFrom(newDate, newTime);

  const { minMs, maxMs, closed } = addTimeWindow(
    data.timeCandidates.map((c: TimeCand) => c.startsAt),
    data.decidesBy ?? null,
    Date.now(),
  );
  // The window has fully elapsed: there is no slot left to add, and opening the picker would feed it
  // inverted bounds. Show why instead of a (crash-prone) composer - the plan locks onto its existing
  // candidates next deadline sweep.
  if (closed) {
    return (
      <AppText variant="caption" style={{ color: ui.muted, marginTop: 8 }}>
        This meetup's time window has passed - no new times can be added.
      </AppText>
    );
  }
  const horizonMs = data.timeCandidates.length ? maxMs : null;
  const addMinDate = new Date(minMs);
  const addMaxDate = new Date(maxMs);

  const newMs = newIso ? new Date(newIso).getTime() : null;
  const invalidNote =
    newMs == null
      ? null
      : data.decidesBy && newMs <= new Date(data.decidesBy).getTime()
        ? `Voting closes ${formatSlot(data.decidesBy)} - pick a time after that.`
        : horizonMs != null && newMs > horizonMs
          ? `That's past this meetup's window - the latest is ${formatSlot(new Date(horizonMs).toISOString())}.`
          : null;

  const reset = () => {
    setNewDate("");
    setNewTime("");
  };
  return (
    <AddComposer
      triggerLabel="+ add a time"
      busy={busy}
      canSubmit={!!newIso && !invalidNote}
      onToggle={onToggle}
      onSubmit={() => {
        if (newIso) onAdd(newIso);
        reset();
      }}
      onCancel={reset}
    >
      <DateTimePill
        dateValue={newDate}
        timeValue={newTime}
        onDate={setNewDate}
        onTime={setNewTime}
        minimumDate={addMinDate}
        maximumDate={addMaxDate}
      />
      {invalidNote ? (
        <AppText variant="caption" style={{ color: ui.brand, marginTop: 8 }}>
          {invalidNote}
        </AppText>
      ) : null}
    </AddComposer>
  );
}

// Moment: a blind, timed commitment. We never show who else is in until the timer ends.
export function MomentView({
  data,
  busy,
  reanswering,
  onChangeAnswer,
  statusLine,
  onYes,
  onNo,
  onConditional,
}: {
  data: Detail;
  busy: boolean;
  reanswering: boolean;
  onChangeAnswer: () => void;
  statusLine: string;
  onYes: () => void;
  onNo: () => void;
  onConditional: () => void;
}) {
  const showAnswer = reanswering || !data.myResponse;
  // A blind conditional reads as "awaiting" server-side (we cannot resolve it without leaking), so
  // give the committed-conditional case its own heading instead of the misleading "Awaiting...".
  const lockedHeading =
    data.myResponse?.kind === "conditional" ? "In if your people are" : statusLine;
  return (
    <View style={{ marginTop: 16 }}>
      {showAnswer ? (
        <Section title="Are you in?" sub="Blind until close.">
          <Button
            label="I'm in"
            variant="affirmative"
            disabled={busy}
            onPress={onYes}
            style={{ marginBottom: 10 }}
          />
          <Button
            label="Go if..."
            variant="outline"
            disabled={busy}
            onPress={onConditional}
            style={{ marginBottom: 10 }}
          />
          <Button label={LABEL_CANT_MAKE_IT} variant="outline" disabled={busy} onPress={onNo} />
        </Section>
      ) : (
        <>
          <StatusHeading>{lockedHeading}</StatusHeading>
          <Card>
            <AppText variant="captionPara">Locked in. Revealed at close.</AppText>
          </Card>
          <Button
            label="Change"
            variant="outline"
            disabled={busy}
            onPress={onChangeAnswer}
            style={{ marginTop: 12 }}
          />
        </>
      )}
    </View>
  );
}

// Reveal: the plan cleared - show the crowd who's in (only the IN crowd is ever listed).
export function RevealView({ data, statusLine }: { data: Detail; statusLine: string }) {
  return (
    <View style={{ marginTop: 16 }}>
      <StatusHeading>{statusLine}</StatusHeading>
      <FieldLabel tone="muted" style={{ marginBottom: 8 }}>
        Who's in
      </FieldLabel>
      <Card padding={0}>
        {data.going.map((p, i) => (
          <PersonRow
            key={p.id}
            name={p.name}
            color={p.color}
            index={i}
            right={<Text style={{ color: ui.going }}>{"✓"}</Text>}
          />
        ))}
        {data.going.length === 0 && (
          <AppText variant="caption" style={{ padding: 14 }}>
            No one's in.
          </AppText>
        )}
      </Card>
    </View>
  );
}
