import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
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
import { defaultLockAt } from "../lib/lock";
import { type QuickPick, quickPicks } from "../lib/quickpicks";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { BackBar, Button, Card, Chip, DateTimePill, Field, ScreenBackground, Toggle } from "../ui";

type Group = Awaited<ReturnType<typeof trpc.groups.mine.query>>[number];
type Props = NativeStackScreenProps<MeetupsStackParams, "CreateEvent">;
type Row = { id: string; date: string; time: string };

function Overline({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: font.bold,
        fontSize: 9,
        letterSpacing: 1,
        textTransform: "uppercase",
        color: ui.ink,
        marginBottom: 6,
      }}
    >
      {children}
    </Text>
  );
}

// Split an ISO instant back into the picker's local "YYYY-MM-DD" / "HH:mm" strings.
function splitIso(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function CreateEvent({ navigation }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  // The only fork: fixed = it's happening at one set time (exact); flexible = people react to one or
  // more times and it auto-locks at a deadline (options).
  const [concrete, setConcrete] = useState(false);
  const [rows, setRows] = useState<Row[]>([{ id: "o0", date: "", time: "" }]);
  const nextRowId = useRef(1);
  // Lock-in deadline: by default the server picks "the evening before"; the creator can override it.
  const [lockEdit, setLockEdit] = useState(false);
  const [lockDate, setLockDate] = useState("");
  const [lockTime, setLockTime] = useState("");

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
    earliestMs != null ? new Date(defaultLockAt(earliestMs, Date.now())).toISOString() : null;
  const lockOverrideIso = lockEdit ? isoFrom(lockDate, lockTime) : null;
  const lockInvalid =
    !!lockOverrideIso && earliestMs != null && new Date(lockOverrideIso).getTime() >= earliestMs;
  const lockToSend = lockEdit && lockOverrideIso && !lockInvalid ? lockOverrideIso : undefined;

  const missing = !groupId
    ? "a group"
    : title.trim() === ""
      ? "a title"
      : (concrete ? exactIso === null : optionIsos.length < 1)
        ? "a time"
        : lockInvalid
          ? "a valid lock-in time"
          : null;

  function applyQuickPick(qp: QuickPick) {
    setRows((rs) => {
      if (concrete) return rs.map((r, i) => (i === 0 ? { ...r, date: qp.date, time: qp.time } : r));
      const emptyIdx = rs.findIndex((r) => !r.date && !r.time);
      if (emptyIdx >= 0)
        return rs.map((r, i) => (i === emptyIdx ? { ...r, date: qp.date, time: qp.time } : r));
      if (rs.length < 6)
        return [...rs, { id: `o${nextRowId.current++}`, date: qp.date, time: qp.time }];
      return rs.map((r, i) => (i === rs.length - 1 ? { ...r, date: qp.date, time: qp.time } : r));
    });
  }

  function startEditLock() {
    if (autoLockIso) {
      const { date, time } = splitIso(autoLockIso);
      setLockDate(date);
      setLockTime(time);
    }
    setLockEdit(true);
  }

  async function create() {
    if (missing || !groupId || busy) return;
    setBusy(true);
    try {
      const base = {
        groupId,
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
      };
      if (concrete && exactIso) {
        await trpc.events.create.mutate({ ...base, when: { mode: "exact", startsAt: exactIso } });
      } else {
        await trpc.events.create.mutate({
          ...base,
          when: { mode: "options", options: optionIsos },
          lockAt: lockToSend,
        });
      }
      navigation.goBack();
    } catch {
      setError(true);
      setBusy(false);
    }
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

  if (!error && groups.length === 0) {
    return (
      <ScreenBackground
        header={<BackBar title="Suggest a meet" onBack={() => navigation.goBack()} />}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          <Text
            style={{
              fontFamily: font.medium,
              fontSize: 13,
              color: ui.muted,
              marginTop: 8,
              lineHeight: 20,
            }}
          >
            You're not in any groups yet. Create or join a group first, then you can plan a meetup.
          </Text>
        </ScrollView>
      </ScreenBackground>
    );
  }

  const picks = quickPicks();

  return (
    <ScreenBackground
      header={<BackBar title="Suggest a meet" onBack={() => navigation.goBack()} />}
    >
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
          {error && (
            <Text style={{ fontFamily: font.medium, color: ui.brand, marginBottom: 10 }}>
              Something went wrong. Try again.
            </Text>
          )}
          <Text
            style={{
              fontFamily: font.medium,
              fontSize: 11,
              color: ui.muted,
              marginBottom: 12,
              lineHeight: 16,
            }}
          >
            Only the group, a title and a time are needed - everything tagged "optional" can wait.
          </Text>

          <Overline>Group</Overline>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 6 }}>
            {groups.map((g) => (
              <Chip
                key={g.id}
                label={g.name}
                selected={groupId === g.id}
                onPress={() => setGroupId(g.id)}
              />
            ))}
          </View>

          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Bowling"
            style={{ marginTop: 8 }}
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

          <View style={{ marginTop: 18 }}>
            <Overline>When</Overline>
            <Toggle
              options={["Flexible", "Fixed"]}
              value={concrete ? "Fixed" : "Flexible"}
              onChange={(v) => setConcrete(v === "Fixed")}
            />
            <Text
              style={{
                fontFamily: font.medium,
                fontSize: 11,
                color: ui.muted,
                marginTop: 6,
                lineHeight: 16,
              }}
            >
              {concrete
                ? "One set time - it's happening, who's in?"
                : "Offer a time or two; people react and it locks at a deadline."}
            </Text>
          </View>

          {/* Quick picks prefill the pickers - in flexible mode they fill the next empty slot. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 10 }}>
            {picks.map((qp) => (
              <Chip key={qp.key} label={qp.label} onPress={() => applyQuickPick(qp)} />
            ))}
          </View>

          {concrete ? (
            <DateTimePill
              style={{ marginTop: 10 }}
              dateValue={rows[0].date}
              timeValue={rows[0].time}
              onDate={(t) => setRows((rs) => rs.map((r, i) => (i === 0 ? { ...r, date: t } : r)))}
              onTime={(t) => setRows((rs) => rs.map((r, i) => (i === 0 ? { ...r, time: t } : r)))}
              minimumDate={new Date()}
            />
          ) : (
            <View style={{ marginTop: 10 }}>
              {rows.map((r) => (
                <View
                  key={r.id}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}
                >
                  <DateTimePill
                    style={{ flex: 1 }}
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
                      hitSlop={8}
                    >
                      <Text style={{ fontFamily: font.bold, fontSize: 18, color: ui.muted }}>
                        ✕
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

              {/* Lock-in deadline (flexible only). */}
              <View style={{ marginTop: 18 }}>
                <Overline>Locks in</Overline>
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
                      style={{
                        fontFamily: font.medium,
                        fontSize: 11,
                        color: ui.muted,
                        marginTop: 3,
                      }}
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
              </View>
            </View>
          )}

          <Button
            label={concrete ? "Start the moment" : "Float it"}
            variant="primary"
            disabled={!!missing || busy}
            onPress={create}
            style={{ marginTop: 22 }}
          />
          {missing && (
            <Text
              style={{
                fontFamily: font.medium,
                fontSize: 12,
                color: ui.muted,
                marginTop: 10,
                textAlign: "center",
              }}
            >
              {`Add ${missing} to continue`}
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}
