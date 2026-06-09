import { useState } from "react";
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
}: {
  data: Detail;
  busy: boolean;
  onToggleReaction: (candidateId: string) => void;
  onToggleOptOut: () => void;
  onLock: (candidateId?: string) => void;
  onAddTime: (startsAt: string) => void;
  onAddActivity: (text: string) => void;
}) {
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
          {!data.lockActivity && <AddActivity busy={busy} onAdd={onAddActivity} />}
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
          {!data.lockTimes && <AddTime busy={busy} data={data} onAdd={onAddTime} />}
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
function AddActivity({ busy, onAdd }: { busy: boolean; onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <AddComposer
      triggerLabel="+ add an activity"
      busy={busy}
      canSubmit={!!text.trim()}
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

// Inline concrete time entry through the shared AddComposer, bounded to a sensible horizon from the
// existing candidate spread. De-duped by minute server-side.
function AddTime({
  busy,
  data,
  onAdd,
}: {
  busy: boolean;
  data: Detail;
  onAdd: (startsAt: string) => void;
}) {
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

  const reset = () => {
    setNewDate("");
    setNewTime("");
  };
  return (
    <AddComposer
      triggerLabel="+ add a time"
      busy={busy}
      canSubmit={!!newIso}
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
