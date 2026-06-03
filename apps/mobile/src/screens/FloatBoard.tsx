import type { PartOfDay } from "@bethere/shared";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { formatCountdown, partOfDayLabel, shortDayLabel } from "../lib/format";
import { trpc } from "../lib/trpc";
import { useBusyAction } from "../lib/useBusyAction";
import { useLiveClock } from "../lib/useLiveClock";
import { font, ui } from "../theme";
import {
  BackBar,
  Button,
  Card,
  DetailError,
  DrainBar,
  Field,
  FloatChip,
  HardShadow,
  ScreenBackground,
  ScreenLoading,
} from "../ui";

type FloatGet = Awaited<ReturnType<typeof trpc.floats.get.query>>;
type Brew = Extract<NonNullable<FloatGet>, { phase: "floating" }>;
type Props = NativeStackScreenProps<MeetupsStackParams, "FloatBoard">;

// Mirrors the shared PartOfDay enum (packages/shared schemas.ts); Metro cannot value-import it.
const BANDS = ["morning", "afternoon", "evening", "late"] as const;

export function FloatBoard({ route, navigation }: Props) {
  const { floatId } = route.params;
  const [board, setBoard] = useState<Brew | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = useLiveClock();
  // Suggestion ids with an in-flight +1 toggle: while any are pending we skip applying poll data so
  // the optimistic chip never flickers (the next clean poll reconciles the true count).
  const pending = useRef<Set<string>>(new Set());

  const load = useCallback(() => {
    return trpc.floats.get
      .query({ id: floatId })
      .then((d) => {
        if (!d) {
          setError(true);
          return;
        }
        if (d.phase === "tipped") {
          // It caught on while we were looking - hand off to the normal plan view; back goes home.
          navigation.replace("EventDetail", { eventId: d.eventId });
          return;
        }
        if (pending.current.size === 0) setBoard(d);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [floatId, navigation]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load();
      const poll = setInterval(() => active && load(), 5000);
      return () => {
        active = false;
        clearInterval(poll);
      };
    }, [load]),
  );

  // One-tap +1 / un-+1, optimistic. A failed toggle reverts; the poll reconciles once it settles.
  function toggle(id: string, axis: "idea" | "time") {
    const flip = (b: Brew | null): Brew | null => {
      if (!b) return b;
      const upd = <T extends { id: string; mine: boolean; count: number }>(arr: T[]): T[] =>
        arr.map((c) =>
          c.id === id ? { ...c, mine: !c.mine, count: c.count + (c.mine ? -1 : 1) } : c,
        );
      return axis === "idea" ? { ...b, ideas: upd(b.ideas) } : { ...b, times: upd(b.times) };
    };
    setBoard(flip);
    pending.current.add(id);
    trpc.floats.toggleVote
      .mutate({ eventId: floatId, suggestionId: id })
      .catch(() => setBoard(flip))
      .finally(() => pending.current.delete(id));
  }

  const runAction = useBusyAction({ busy, setBusy, setError, load });

  const addIdea = (text: string) =>
    runAction(() => trpc.floats.addIdea.mutate({ eventId: floatId, text }));

  const addTime = (dayIso: string, band: PartOfDay) =>
    runAction(() => trpc.floats.addTime.mutate({ eventId: floatId, day: dayIso, band }));

  if (loading) return <ScreenLoading />;
  if (error || !board) {
    return (
      <DetailError
        error={error}
        onBack={() => navigation.goBack()}
        notFoundLabel="This float is gone."
      />
    );
  }

  const tipMs = board.tipAt ? new Date(board.tipAt).getTime() - now : 0;
  const start = new Date(board.createdAt).getTime();
  const end = board.tipAt ? new Date(board.tipAt).getTime() : start;
  const frac = end <= start ? 1 : Math.max(0, Math.min(1, (end - now) / (end - start)));
  const hot = frac < 0.25;

  return (
    <ScreenBackground
      header={<BackBar title={board.groupName} onBack={() => navigation.goBack()} />}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Draining deadline bar - it auto-tips on its own, nobody locks it. */}
        <View style={{ marginBottom: 16 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 7,
            }}
          >
            <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>Brewing</Text>
            <Text style={{ fontFamily: font.mono, fontSize: 11, color: hot ? ui.brand : ui.ink }}>
              {`auto-tips ${formatCountdown(tipMs)}`}
            </Text>
          </View>
          <DrainBar frac={frac} hot={hot} />
        </View>

        <Card style={{ marginBottom: 18 }}>
          <Text style={{ fontFamily: font.display, fontSize: 17, color: ui.ink }}>
            Someone floated an idea
          </Text>
          <Text
            style={{
              fontFamily: font.medium,
              fontSize: 12,
              color: ui.muted,
              marginTop: 6,
              lineHeight: 18,
            }}
          >
            No names shown. Tap what you're into - a +1 means you're keen, not committed. When it
            catches on it turns into a real plan and asks who's in.
          </Text>
        </Card>

        <Section title="What could we do?">
          <ChipWrap>
            {board.ideas.map((c) => (
              <FloatChip
                key={c.id}
                label={c.text}
                count={c.count}
                mine={c.mine}
                onPress={() => toggle(c.id, "idea")}
              />
            ))}
          </ChipWrap>
          <AddIdea busy={busy} onAdd={addIdea} />
        </Section>

        <Section title="When works?">
          {board.times.length === 0 && (
            <Text
              style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted, marginBottom: 8 }}
            >
              Be the first to drop a time.
            </Text>
          )}
          <ChipWrap>
            {board.times.map((c) => (
              <FloatChip
                key={c.id}
                label={`${shortDayLabel(new Date(c.startsAt ?? board.createdAt))} · ${partOfDayLabel(c.band)}`}
                count={c.count}
                mine={c.mine}
                onPress={() => toggle(c.id, "time")}
              />
            ))}
          </ChipWrap>
          <AddTime busy={busy} onAdd={addTime} />
        </Section>
      </ScrollView>
    </ScreenBackground>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={{ fontFamily: font.display, fontSize: 14, color: ui.ink, marginBottom: 10 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function ChipWrap({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{children}</View>;
}

// Inline free-text idea entry: a +chip that opens a field, de-duped server-side.
function AddIdea({ busy, onAdd }: { busy: boolean; onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={6} style={{ marginTop: 2 }}>
        <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.brand }}>+ add an idea</Text>
      </Pressable>
    );
  }
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
    setOpen(false);
  };
  return (
    <View style={{ marginTop: 6 }}>
      <Field
        label="Add an idea"
        value={text}
        onChangeText={setText}
        placeholder="bowling, the pub..."
      />
      <View style={{ flexDirection: "row", gap: 16, marginTop: 12, justifyContent: "flex-end" }}>
        <Pressable
          hitSlop={8}
          onPress={() => {
            setText("");
            setOpen(false);
          }}
        >
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.muted }}>Cancel</Text>
        </Pressable>
        <View style={{ width: 110 }}>
          <Button label="Add" variant="primary" disabled={busy || !text.trim()} onPress={submit} />
        </View>
      </View>
    </View>
  );
}

// A light band picker: pick a day (next week) + a part-of-day, then add. No precise clock - floats
// stay loose.
function AddTime({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (dayIso: string, band: PartOfDay) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dayIdx, setDayIdx] = useState<number | null>(null);
  const [band, setBand] = useState<PartOfDay | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    d.setHours(12, 0, 0, 0);
    return d;
  });

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={6} style={{ marginTop: 2 }}>
        <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.brand }}>+ add a time</Text>
      </Pressable>
    );
  }

  const reset = () => {
    setOpen(false);
    setDayIdx(null);
    setBand(null);
  };
  const submit = () => {
    if (dayIdx === null || !band) return;
    onAdd(days[dayIdx].toISOString(), band);
    reset();
  };

  return (
    <Card style={{ marginTop: 8 }}>
      <PickerRow label="Day">
        {days.map((d, i) => (
          <MiniChip
            key={d.toISOString()}
            label={shortDayLabel(d)}
            selected={dayIdx === i}
            onPress={() => setDayIdx(i)}
          />
        ))}
      </PickerRow>
      <PickerRow label="Time of day">
        {BANDS.map((b) => (
          <MiniChip
            key={b}
            label={partOfDayLabel(b)}
            selected={band === b}
            onPress={() => setBand(b)}
          />
        ))}
      </PickerRow>
      <View style={{ flexDirection: "row", gap: 16, marginTop: 6, justifyContent: "flex-end" }}>
        <Pressable hitSlop={8} onPress={reset}>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.muted }}>Cancel</Text>
        </Pressable>
        <View style={{ width: 110 }}>
          <Button
            label="Add"
            variant="primary"
            disabled={busy || dayIdx === null || !band}
            onPress={submit}
          />
        </View>
      </View>
    </Card>
  );
}

function PickerRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text
        style={{
          fontFamily: font.bold,
          fontSize: 9,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: ui.ink,
          marginBottom: 8,
        }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{children}</View>
    </View>
  );
}

function MiniChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <HardShadow radius={ui.rInput} offset={2} style={{ marginRight: 7, marginBottom: 7 }}>
      <Pressable
        onPress={onPress}
        style={{
          backgroundColor: selected ? ui.ink : ui.surface,
          borderWidth: ui.border,
          borderColor: ui.ink,
          borderRadius: ui.rInput,
          paddingVertical: 6,
          paddingHorizontal: 11,
        }}
      >
        <Text style={{ fontFamily: font.bold, fontSize: 12, color: selected ? "#fff" : ui.ink }}>
          {label}
        </Text>
      </Pressable>
    </HardShadow>
  );
}
