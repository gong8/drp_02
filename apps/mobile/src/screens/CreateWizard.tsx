import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import type { MeetupsStackParams } from "../../App";
import { formatSlot, isoFrom } from "../lib/format";
import { defaultLockAtForOptions } from "../lib/lock";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { BackBar, Button, Card, Chip, DateTimePill, Field, ScreenBackground, Toggle } from "../ui";

type Group = Awaited<ReturnType<typeof trpc.groups.mine.query>>[number];
type Branch = "float" | "rough" | "set";
type Row = { id: string; date: string; time: string };
type Props = NativeStackScreenProps<MeetupsStackParams, "CreateWizard">;

const STEPS: Record<Branch, string[]> = {
  float: ["group", "spark", "window"],
  rough: ["group", "what", "when", "details", "lock"],
  set: ["group", "what", "when", "details"],
};
const TITLES: Record<Branch, string> = {
  float: "Float an idea",
  rough: "Rough plan",
  set: "It's set",
};

// Split an ISO instant back into the picker's local "YYYY-MM-DD" / "HH:mm" strings.
function splitIso(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function CreateWizard({ route, navigation }: Props) {
  const { branch } = route.params;
  const steps = STEPS[branch];
  const [step, setStep] = useState(0);
  const key = steps[step];
  const last = step === steps.length - 1;

  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([{ id: "o0", date: "", time: "" }]);
  const nextRowId = useRef(1);
  const [lockEdit, setLockEdit] = useState(false);
  const [lockDate, setLockDate] = useState("");
  const [lockTime, setLockTime] = useState("");
  // Float-only.
  const [ideaChips, setIdeaChips] = useState<string[]>([]);
  const [ideaDraft, setIdeaDraft] = useState("");
  const [timescale, setTimescale] = useState<"this_week" | "this_weekend">("this_week");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

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

  const exactIso = isoFrom(rows[0].date, rows[0].time);
  const optionIsos = rows
    .map((r) => isoFrom(r.date, r.time))
    .filter((x): x is string => x !== null);
  const earliestMs = optionIsos.length
    ? Math.min(...optionIsos.map((iso) => new Date(iso).getTime()))
    : null;
  const autoLockIso =
    earliestMs != null ? new Date(defaultLockAtForOptions(earliestMs, Date.now())).toISOString() : null;
  const lockOverrideIso = lockEdit ? isoFrom(lockDate, lockTime) : null;
  const lockInvalid =
    !!lockOverrideIso && earliestMs != null && new Date(lockOverrideIso).getTime() >= earliestMs;
  const lockToSend = lockEdit && lockOverrideIso && !lockInvalid ? lockOverrideIso : undefined;
  const sparkReady = ideaChips.length > 0 || ideaDraft.trim().length > 0;

  function valid(k: string): boolean {
    switch (k) {
      case "group":
        return !!groupId;
      case "what":
        return title.trim() !== "";
      case "when":
        return branch === "set" ? exactIso !== null : optionIsos.length >= 1;
      case "lock":
        return !lockInvalid;
      case "spark":
        return sparkReady;
      default:
        return true; // details, window
    }
  }

  // Fold the typed-but-not-added idea into the chip list (case-insensitive de-dup), returning the
  // resulting set so submit can use it synchronously.
  function commitDraftIdea(): string[] {
    const t = ideaDraft.trim();
    if (!t) return ideaChips;
    setIdeaDraft("");
    if (ideaChips.some((c) => c.toLowerCase() === t.toLowerCase())) return ideaChips;
    const next = [...ideaChips, t];
    setIdeaChips(next);
    return next;
  }

  function startEditLock() {
    if (autoLockIso) {
      const { date, time } = splitIso(autoLockIso);
      setLockDate(date);
      setLockTime(time);
    }
    setLockEdit(true);
  }

  async function submit() {
    if (busy || !groupId) return;
    setBusy(true);
    try {
      if (branch === "float") {
        const ideas = commitDraftIdea();
        const { id } = await trpc.floats.create.mutate({
          groupId,
          ideas,
          window: { timescale, band: "evening" },
        });
        navigation.reset({
          index: 1,
          routes: [{ name: "Dashboard" }, { name: "FloatBoard", params: { floatId: id } }],
        });
        return;
      }
      const base = {
        groupId,
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
      };
      if (branch === "set" && exactIso) {
        await trpc.events.create.mutate({ ...base, when: { mode: "exact", startsAt: exactIso } });
      } else {
        await trpc.events.create.mutate({
          ...base,
          when: { mode: "options", options: optionIsos },
          lockAt: lockToSend,
        });
      }
      navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] });
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  function goNext() {
    if (!valid(key) || busy) return;
    if (key === "spark") commitDraftIdea();
    if (last) submit();
    else setStep(step + 1);
  }
  function goBack() {
    if (step > 0) setStep(step - 1);
    else navigation.goBack();
  }

  if (loading) {
    return (
      <ScreenBackground>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={ui.ink} />
        </View>
      </ScreenBackground>
    );
  }

  const nextLabel = !last
    ? "Next"
    : branch === "float"
      ? "Float it"
      : branch === "set"
        ? "Start the moment"
        : "Suggest it";

  return (
    <ScreenBackground header={<BackBar title={TITLES[branch]} onBack={goBack} />}>
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
          <ProgressDots steps={steps} index={step} />
          {error && (
            <Text style={{ fontFamily: font.medium, color: ui.brand, marginBottom: 10 }}>
              Something went wrong. Try again.
            </Text>
          )}

          {key === "group" && (
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

          {key === "what" && (
            <Step title="What is it?">
              <Field label="Title" value={title} onChangeText={setTitle} placeholder="Bowling" />
            </Step>
          )}

          {key === "spark" && (
            <Step
              title="What's the spark?"
              sub="Drop a loose idea or two - the group adds more and piles on. You stay anonymous."
            >
              <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 4 }}>
                {ideaChips.map((c) => (
                  <RemovableChip
                    key={c}
                    label={c}
                    onRemove={() => setIdeaChips((cs) => cs.filter((x) => x !== c))}
                  />
                ))}
              </View>
              <Field
                label="Add an idea"
                value={ideaDraft}
                onChangeText={setIdeaDraft}
                placeholder="bowling, the pub..."
              />
              <View style={{ flexDirection: "row", marginTop: 10 }}>
                <Chip label="+ Add" onPress={commitDraftIdea} />
              </View>
            </Step>
          )}

          {key === "window" && (
            <Step
              title="Roughly when?"
              sub="Just a window - the exact time gets sorted as people pile on."
            >
              <Toggle
                options={["This week", "This weekend"]}
                value={timescale === "this_week" ? "This week" : "This weekend"}
                onChange={(v) => setTimescale(v === "This weekend" ? "this_weekend" : "this_week")}
              />
            </Step>
          )}

          {key === "when" && branch === "set" && (
            <Step title="When is it?">
              <DateTimePill
                dateValue={rows[0].date}
                timeValue={rows[0].time}
                onDate={(t) => setRows((rs) => rs.map((r, i) => (i === 0 ? { ...r, date: t } : r)))}
                onTime={(t) => setRows((rs) => rs.map((r, i) => (i === 0 ? { ...r, time: t } : r)))}
                minimumDate={new Date()}
              />
            </Step>
          )}

          {key === "when" && branch === "rough" && (
            <Step
              title="When could it be?"
              sub="Offer a time or two - people react and the best-supported wins."
            >
              {rows.map((r) => (
                <View key={r.id} style={{ position: "relative", marginBottom: 10 }}>
                  <DateTimePill
                    dateValue={r.date}
                    timeValue={r.time}
                    onDate={(t) =>
                      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, date: t } : x)))
                    }
                    onTime={(t) =>
                      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, time: t } : x)))
                    }
                    minimumDate={new Date()}
                  />
                  {rows.length > 1 && (
                    <Pressable
                      onPress={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
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
                      <Text
                        style={{
                          fontFamily: font.bold,
                          fontSize: 13,
                          lineHeight: 13,
                          color: ui.ink,
                        }}
                      >
                        ×
                      </Text>
                    </Pressable>
                  )}
                </View>
              ))}
              {rows.length < 6 && (
                <Chip
                  label="+ Add a time"
                  onPress={() =>
                    setRows((rs) => [...rs, { id: `o${nextRowId.current++}`, date: "", time: "" }])
                  }
                />
              )}
            </Step>
          )}

          {key === "details" && (
            <Step title="Anything else?" sub="Both optional - skip if you like.">
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
            </Step>
          )}

          {key === "lock" && (
            <Step title="When does it lock?">
              {lockEdit ? (
                <Card>
                  <DateTimePill
                    dateValue={lockDate}
                    timeValue={lockTime}
                    onDate={setLockDate}
                    onTime={setLockTime}
                    minimumDate={new Date()}
                  />
                  {lockInvalid && (
                    <Text
                      style={{
                        fontFamily: font.medium,
                        fontSize: 11,
                        color: ui.brand,
                        marginTop: 8,
                      }}
                    >
                      The deadline has to be before your earliest time.
                    </Text>
                  )}
                  <View style={{ flexDirection: "row", marginTop: 12 }}>
                    <Chip
                      label="Use default"
                      onPress={() => {
                        setLockEdit(false);
                        setLockDate("");
                        setLockTime("");
                      }}
                    />
                  </View>
                </Card>
              ) : (
                <Card>
                  <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>
                    {autoLockIso ? `Locks ${formatSlot(autoLockIso)}` : "Pick a time first"}
                  </Text>
                  <Text
                    style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 3 }}
                  >
                    the evening before - best-supported time wins
                  </Text>
                  {autoLockIso && (
                    <View style={{ flexDirection: "row", marginTop: 10 }}>
                      <Chip label="Change" onPress={startEditLock} />
                    </View>
                  )}
                </Card>
              )}
            </Step>
          )}

          <Button
            label={nextLabel}
            variant="primary"
            disabled={!valid(key) || busy}
            onPress={goNext}
            style={{ marginTop: 24 }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

function ProgressDots({ steps, index }: { steps: string[]; index: number }) {
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
