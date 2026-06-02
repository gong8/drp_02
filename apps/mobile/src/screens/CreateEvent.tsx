import type { PartOfDay, Timescale, WhenMode } from "@bethere/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { isoFrom } from "../lib/format";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { BackBar, Button, Card, Chip, DateTimeField, Field, ScreenBackground } from "../ui";

type Group = Awaited<ReturnType<typeof trpc.groups.mine.query>>[number];
type Props = NativeStackScreenProps<MeetupsStackParams, "CreateEvent">;

// How precisely the creator pins the time. This single choice is the only fork the user sees - it
// silently routes the plan into an instant blind moment (exact) or a collecting phase (the rest).
// Option values derive from the shared Zod enums (WhenMode / Timescale / PartOfDay).
const MODES: { mode: WhenMode; label: string; hint: string }[] = [
  { mode: "exact", label: "Set a time", hint: "It's happening - who's in?" },
  { mode: "options", label: "A few options", hint: "People pick what works, you lock it." },
  // Hidden until iteration 3 (loose "whenever suits" window). Backend/JSX below stay intact.
  // Iteration 3: { mode: "fuzzy", label: "Whenever suits", hint: "Float it - we'll find a time together." },
];

const TIMESCALES: { value: Timescale; label: string }[] = [
  { value: "tonight", label: "Tonight" },
  { value: "this_week", label: "This week" },
  { value: "this_weekend", label: "This weekend" },
  { value: "next_two_weeks", label: "Next 2 weeks" },
];

const BANDS: { value: PartOfDay; label: string }[] = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
  { value: "late", label: "Late" },
];

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

export function CreateEvent({ navigation }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [mode, setMode] = useState<WhenMode>("exact");

  // exact
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  // options (a small menu of date+time rows)
  const [optionRows, setOptionRows] = useState<{ id: string; date: string; time: string }[]>([
    { id: "o0", date: "", time: "" },
    { id: "o1", date: "", time: "" },
  ]);
  const nextOptionId = useRef(2);
  // fuzzy
  const [timescale, setTimescale] = useState<Timescale | null>(null);
  const [band, setBand] = useState<PartOfDay | null>(null);

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

  const exactIso = isoFrom(date, time);
  const optionIsos = optionRows
    .map((r) => isoFrom(r.date, r.time))
    .filter((x): x is string => x !== null);

  const ready =
    !!groupId &&
    title.trim() !== "" &&
    (mode === "exact"
      ? exactIso !== null
      : mode === "options"
        ? optionIsos.length >= 2
        : timescale !== null && band !== null);

  async function create() {
    if (!ready || !groupId || busy) return;
    setBusy(true);
    try {
      const base = {
        groupId,
        title: title.trim(),
        description: undefined,
        location: location.trim() || undefined,
      };
      if (mode === "exact" && exactIso) {
        await trpc.events.create.mutate({ ...base, when: { mode: "exact", startsAt: exactIso } });
      } else if (mode === "options") {
        await trpc.events.create.mutate({
          ...base,
          when: { mode: "options", options: optionIsos },
        });
      } else if (timescale && band) {
        await trpc.events.create.mutate({ ...base, when: { mode: "fuzzy", timescale, band } });
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
      <ScreenBackground>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          <BackBar title="Suggest a meet" onBack={() => navigation.goBack()} />
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

  return (
    <ScreenBackground>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <BackBar title="Suggest a meet" onBack={() => navigation.goBack()} />
        {error && (
          <Text style={{ fontFamily: font.medium, color: ui.brand, marginBottom: 10 }}>
            Something went wrong. Try again.
          </Text>
        )}

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
          label={mode === "fuzzy" ? "Place (optional)" : "Location"}
          value={location}
          onChangeText={setLocation}
          placeholder="TenPin Bexleyheath"
          style={{ marginTop: 12 }}
        />

        <View style={{ marginTop: 18 }}>
          <Overline>When</Overline>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {MODES.map((m) => (
              <Chip
                key={m.mode}
                label={m.label}
                selected={mode === m.mode}
                onPress={() => setMode(m.mode)}
              />
            ))}
          </View>
          <Text
            style={{
              fontFamily: font.medium,
              fontSize: 11,
              color: ui.muted,
              marginTop: 2,
              marginBottom: 4,
            }}
          >
            {MODES.find((m) => m.mode === mode)?.hint}
          </Text>
        </View>

        {mode === "exact" && (
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <DateTimeField
              mode="date"
              value={date}
              onChange={setDate}
              minimumDate={new Date()}
              style={{ flex: 1 }}
            />
            <DateTimeField
              mode="time"
              value={time}
              onChange={setTime}
              minuteInterval={15}
              style={{ flex: 1 }}
            />
          </View>
        )}

        {mode === "options" && (
          <View style={{ marginTop: 8 }}>
            {optionRows.map((r, i) => (
              <Card key={r.id} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
                  <Text
                    style={{
                      fontFamily: font.bold,
                      fontSize: 9,
                      letterSpacing: 1,
                      textTransform: "uppercase",
                      color: ui.ink,
                    }}
                  >
                    {`Option ${i + 1}`}
                  </Text>
                  {optionRows.length > 2 && (
                    <Pressable
                      onPress={() => setOptionRows((rows) => rows.filter((x) => x.id !== r.id))}
                      hitSlop={8}
                      style={{ marginLeft: "auto" }}
                    >
                      <Text style={{ fontFamily: font.bold, fontSize: 11, color: ui.brand }}>
                        Remove
                      </Text>
                    </Pressable>
                  )}
                </View>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <DateTimeField
                    mode="date"
                    value={r.date}
                    onChange={(t) =>
                      setOptionRows((rows) =>
                        rows.map((x) => (x.id === r.id ? { ...x, date: t } : x)),
                      )
                    }
                    minimumDate={new Date()}
                    style={{ flex: 1 }}
                  />
                  <DateTimeField
                    mode="time"
                    value={r.time}
                    onChange={(t) =>
                      setOptionRows((rows) =>
                        rows.map((x) => (x.id === r.id ? { ...x, time: t } : x)),
                      )
                    }
                    minuteInterval={15}
                    style={{ flex: 1 }}
                  />
                </View>
              </Card>
            ))}
            {optionRows.length < 6 && (
              <Chip
                label="+ Add a time"
                onPress={() =>
                  setOptionRows((rows) => [
                    ...rows,
                    { id: `o${nextOptionId.current++}`, date: "", time: "" },
                  ])
                }
              />
            )}
          </View>
        )}

        {mode === "fuzzy" && (
          <View style={{ marginTop: 8 }}>
            <Overline>Timescale</Overline>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {TIMESCALES.map((t) => (
                <Chip
                  key={t.value}
                  label={t.label}
                  selected={timescale === t.value}
                  onPress={() => setTimescale(t.value)}
                />
              ))}
            </View>
            <View style={{ marginTop: 8 }}>
              <Overline>Time of day</Overline>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {BANDS.map((b) => (
                  <Chip
                    key={b.value}
                    label={b.label}
                    selected={band === b.value}
                    onPress={() => setBand(b.value)}
                  />
                ))}
              </View>
            </View>
          </View>
        )}

        <Button
          label={mode === "exact" ? "Start the moment" : "Float it"}
          variant="primary"
          disabled={!ready || busy}
          onPress={create}
          style={{ marginTop: 22 }}
        />
      </ScrollView>
    </ScreenBackground>
  );
}
