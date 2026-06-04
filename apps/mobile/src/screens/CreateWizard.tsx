import type { PartOfDay } from "@bethere/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { dateStringFrom, formatSlot, isoFrom, splitIso, timeStringFrom } from "../lib/format";
import { defaultDecidesByForCandidates } from "../lib/lock";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import {
  BackBar,
  Button,
  Card,
  Chip,
  DateTimePill,
  Field,
  ScreenBackground,
  ScreenLoading,
} from "../ui";

type Group = Awaited<ReturnType<typeof trpc.groups.mine.query>>[number];
type Row = { id: string; date: string; time: string };
type Props = NativeStackScreenProps<MeetupsStackParams, "CreateWizard">;

const STEPS = ["group", "activities", "times", "options", "confirm"] as const;

// Quick part-of-day chips resolve CLIENT-side to a concrete time candidate (today/tomorrow at the
// band hour) so the server only ever sees concrete timeCandidates - there is no server fuzzy path.
const PART_HOUR: Record<PartOfDay, number> = { morning: 9, afternoon: 14, evening: 19, late: 22 };

export function CreateWizard({ navigation }: Props) {
  const [step, setStep] = useState(0);
  const stepKey = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  // Title is never set in the wizard - the server resolves the winning activity into it at lock, so
  // we always send it blank (omitted). Kept here as the single source for the create call's `title`.
  const title = "";
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  // Activity ("what / where") candidates - chips, optional, no names ever shown.
  const [activityChips, setActivityChips] = useState<string[]>([]);
  const [activityDraft, setActivityDraft] = useState("");
  // Time candidates - concrete multi-row rows, optional. Part-of-day chips append concrete rows.
  const [rows, setRows] = useState<Row[]>([{ id: "t0", date: "", time: "" }]);
  const nextRowId = useRef(1);
  // Creator locks - both default OFF (open). Decides-by is editable.
  const [lockTimes, setLockTimes] = useState(false);
  const [lockThings, setLockThings] = useState(false);
  const [decidesEdit, setDecidesEdit] = useState(false);
  const [decidesDate, setDecidesDate] = useState("");
  const [decidesTime, setDecidesTime] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const updateRow = (id: string, patch: Partial<Row>) =>
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
  const decidesInvalid =
    !!decidesOverrideIso &&
    earliestMs != null &&
    new Date(decidesOverrideIso).getTime() >= earliestMs;
  const decidesToSend =
    decidesEdit && decidesOverrideIso && !decidesInvalid ? decidesOverrideIso : undefined;
  // Concrete shortcut: exactly one time AND lockTimes => server opens the moment immediately.
  const isConcrete = timeIsos.length === 1 && lockTimes;

  // Append a concrete time row for a part-of-day chip: the next day that is still in the future
  // (today if the band hour has not passed, else tomorrow), at the band's hour.
  function addBandRow(band: PartOfDay) {
    const now = new Date();
    const day = new Date(now);
    day.setHours(PART_HOUR[band], 0, 0, 0);
    if (day.getTime() <= now.getTime()) day.setDate(day.getDate() + 1);
    setRows((rs) => {
      const next = [
        ...rs.filter((r) => r.date || r.time),
        { id: `t${nextRowId.current++}`, date: dateStringFrom(day), time: timeStringFrom(day) },
      ];
      return next.length ? next : rs;
    });
  }

  function valid(key: string): boolean {
    switch (key) {
      case "group":
        return !!groupId;
      case "options":
        return !decidesInvalid;
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
        lockTimes,
        lockThings,
        decidesBy: decidesToSend,
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
              sub="Drop a few options - what or where. Optional, and the group can add more. No names - it's the group's."
            >
              <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 4 }}>
                {activityChips.map((c) => (
                  <RemovableChip
                    key={c}
                    label={c}
                    onRemove={() => setActivityChips((cs) => cs.filter((x) => x !== c))}
                  />
                ))}
              </View>
              <Field
                label="Add a place or thing"
                optional
                value={activityDraft}
                onChangeText={setActivityDraft}
                placeholder="bowling, the pub..."
              />
              <View style={{ flexDirection: "row", marginTop: 10 }}>
                <Chip label="+ Add" onPress={commitDraftActivity} />
              </View>
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
              <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 6 }}>
                <Chip label="Morning" onPress={() => addBandRow("morning")} />
                <Chip label="Afternoon" onPress={() => addBandRow("afternoon")} />
                <Chip label="Evening" onPress={() => addBandRow("evening")} />
                <Chip label="Late" onPress={() => addBandRow("late")} />
              </View>
              {rows.length < 10 && (
                <Chip
                  label="+ Add a time"
                  onPress={() =>
                    setRows((rs) => [...rs, { id: `t${nextRowId.current++}`, date: "", time: "" }])
                  }
                />
              )}
            </Step>
          )}

          {stepKey === "options" && (
            <Step title="A few options" sub="All optional - skip if you like.">
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
              <CheckRow
                label="Lock the times"
                sub="The group can't add more times"
                on={lockTimes}
                onToggle={() => setLockTimes((v) => !v)}
              />
              <CheckRow
                label="Lock the places"
                sub="The group can't add more places or things"
                on={lockThings}
                onToggle={() => setLockThings((v) => !v)}
              />
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink, marginTop: 18 }}>
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
                      It has to decide before your earliest time.
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
                    style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 3 }}
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
                    activityCount: activityChips.length + (activityDraft.trim() ? 1 : 0),
                    isConcrete,
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

function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Pressable
      onPress={onRemove}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        backgroundColor: ui.ink,
        borderRadius: ui.rInput,
        paddingVertical: 7,
        paddingHorizontal: 12,
        marginRight: 8,
        marginBottom: 8,
      }}
    >
      <Text style={{ fontFamily: font.bold, fontSize: 12, color: "#fff" }}>{label}</Text>
      <Text style={{ fontFamily: font.bold, fontSize: 13, lineHeight: 13, color: "#fff" }}>×</Text>
    </Pressable>
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
}: {
  label: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={{ flexDirection: "row", alignItems: "center", marginTop: 16 }}
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

// The plain-English outcome mirror. Three shapes per the contract:
//  - one exact time + lockTimes => it just happens (the concrete shortcut)
//  - 2+ times => a menu the group reacts to
//  - 0 times => loose; the group floats times and the best-supported wins
function confirmMirror({
  timeCount,
  activityCount,
  isConcrete,
  firstTimeIso,
}: {
  timeCount: number;
  activityCount: number;
  isConcrete: boolean;
  firstTimeIso: string | null;
}): string {
  const things =
    activityCount > 0
      ? ` The group picks from ${activityCount} ${activityCount === 1 ? "thing" : "things"} to do.`
      : " The group adds what to do.";
  if (isConcrete && firstTimeIso) {
    return `It's on for ${formatSlot(firstTimeIso)} - this one just happens, the group says who's in.${things}`;
  }
  if (timeCount >= 2) {
    return `You're offering ${timeCount} times - the group reacts and the best-supported one wins.${things}`;
  }
  return `No fixed time yet - the group floats times and the best-supported one wins.${things}`;
}
