import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { formatCountdown, formatSlot, isoFrom, partOfDayLabel } from "../lib/format";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import {
  Avatar,
  BackBar,
  BottomSheet,
  Button,
  Card,
  DateChip,
  DateTimePill,
  HardShadow,
  ScreenBackground,
  SelectCheck,
  StickerTag,
  Toggle,
} from "../ui";

type Detail = NonNullable<Awaited<ReturnType<typeof trpc.events.get.query>>>;
type Member = Detail["members"][number];
type Cand = Detail["candidates"][number];
type Mode = "At least one" | "All of them";
type SaveState = "idle" | "saving" | "saved" | "error";
type Props = NativeStackScreenProps<MeetupsStackParams, "EventDetail">;

export function EventDetail({ route, navigation }: Props) {
  const { eventId } = route.params;
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  // moment conditional sheet
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [mode, setMode] = useState<Mode>("At least one");
  const [condPicked, setCondPicked] = useState<string[]>([]);
  // collecting reactions (seeded once from the server, then edited locally)
  const [reactPicked, setReactPicked] = useState<string[]>([]);
  const [optedOutLocal, setOptedOutLocal] = useState(false);
  // Surfaces whether the latest tap (a reaction or the opt-out) has been persisted yet.
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const seededFor = useRef<string>("");
  const phaseRef = useRef<string>("");
  // Auto-save: the latest reaction set waiting to be persisted + its debounce timer (no submit btn).
  const pendingPicks = useRef<string[] | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    return trpc.events.get
      .query({ id: eventId })
      .then((d) => {
        setData(d);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [eventId]);

  // Persist the current reaction set, debounced (see toggleReact). Deliberately NOT followed by a
  // refetch: that would clobber the optimistic picks and flicker; the 5s poll refreshes the tally
  // and lock-readiness on its own. Failures are swallowed (the next poll reconciles).
  const flushReact = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (pendingPicks.current) {
      const worksCandidateIds = pendingPicks.current;
      pendingPicks.current = null;
      setSaveState("saving");
      trpc.events.react
        .mutate({ eventId, worksCandidateIds })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }
  }, [eventId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load();
      // The 1s ticker only drives the live moment countdown, so only run it during the moment.
      const tick = setInterval(() => {
        if (active && (phaseRef.current === "moment" || phaseRef.current === "collecting"))
          setNow(Date.now());
      }, 1000);
      // Poll while the plan is live so the tally, countdown and reveal converge without a refresh.
      const poll = setInterval(() => {
        if (active && phaseRef.current !== "cleared" && phaseRef.current !== "fizzled") load();
      }, 5000);
      return () => {
        active = false;
        clearInterval(tick);
        clearInterval(poll);
        flushReact(); // persist any reaction tap not yet saved before leaving the screen
      };
    }, [load, flushReact]),
  );

  phaseRef.current = data?.phase ?? "";

  // Seed the reaction picks once per plan (not per focus) so returning to the screen never clobbers
  // candidate taps the user has not yet submitted.
  useEffect(() => {
    if (data && data.phase === "collecting" && seededFor.current !== eventId) {
      setReactPicked(data.myReactionCandidateIds);
      setOptedOutLocal(data.iOptedOut);
      seededFor.current = eventId;
    }
  }, [data, eventId]);

  // Tapping a candidate IS the answer - toggle optimistically and save after a short debounce, so
  // there is no separate "submit" step competing with the deadline. Tapping a time also rejoins
  // anyone who had opted out.
  function toggleReact(id: string) {
    setOptedOutLocal(false);
    setReactPicked((p) => {
      const next = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
      pendingPicks.current = next;
      return next;
    });
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushReact, 500);
  }

  // "I can't make it" - a reversible, private exit. Opting out clears local picks; tapping it again
  // (or any time above) rejoins. Optimistic, with the same save-state feedback as a reaction.
  async function toggleOptOut() {
    const next = !optedOutLocal;
    setOptedOutLocal(next);
    if (next) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      pendingPicks.current = null;
      setReactPicked([]);
    }
    setSaveState("saving");
    try {
      await trpc.events.setOptOut.mutate({ eventId, out: next });
      setSaveState("saved");
      await load();
    } catch {
      setOptedOutLocal(!next);
      setSaveState("error");
    }
  }

  // Re-send the current intent after a failed save (tap on the error status).
  function retrySave() {
    setSaveState("saving");
    if (optedOutLocal) {
      trpc.events.setOptOut
        .mutate({ eventId, out: true })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    } else {
      pendingPicks.current = reactPicked;
      flushReact();
    }
  }

  async function lock(candidateId?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await trpc.events.lock.mutate(
        candidateId ? { eventId, candidateId, momentMinutes: 60 } : { eventId, momentMinutes: 60 },
      );
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  // Anyone in the group can float a new time into the menu while collecting; refetch so it shows.
  async function addCandidate(startsAt: string) {
    if (busy || !data) return;
    setBusy(true);
    try {
      await trpc.events.addCandidate.mutate({ eventId, startsAt });
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function answer(
    kind: "yes" | "no" | "conditional",
    cond?: { mode: "all" | "any"; targetIds: string[] },
  ) {
    if (busy) return;
    setBusy(true);
    try {
      await trpc.events.respond.mutate(cond ? { eventId, kind, cond } : { eventId, kind });
      setEditing(false);
      await load();
    } catch {
      setError(true);
    } finally {
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
  if (error || !data) {
    return (
      <ScreenBackground>
        <View style={{ padding: 16 }}>
          <BackBar title="Back" onBack={() => navigation.goBack()} />
          <Text style={{ fontFamily: font.medium, color: ui.muted }}>
            {error ? "Couldn't reach the server." : "Plan not found."}
          </Text>
        </View>
      </ScreenBackground>
    );
  }

  const liveMsLeft = data.momentEndsAt ? new Date(data.momentEndsAt).getTime() - now : 0;
  const liveMsToLock = data.lockAt ? new Date(data.lockAt).getTime() - now : 0;
  const whenLine =
    data.chosenStartsAt && data.phase !== "collecting" ? formatSlot(data.chosenStartsAt) : null;

  function headerSticker() {
    if (!data) return null;
    // Collecting uses the prominent countdown banner instead of a sticker.
    if (data.phase === "moment")
      return <StickerTag label={`Locks ${formatCountdown(liveMsLeft)}`} />;
    if (data.phase === "cleared") return <StickerTag label="It's on" />;
    return null;
  }

  const statusLine =
    data.myStatus === "going"
      ? "You're in"
      : data.myStatus === "declined"
        ? "You can't make it"
        : "Awaiting your answer";

  return (
    <ScreenBackground
      header={<BackBar title={data.groupName} onBack={() => navigation.goBack()} />}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
      >
        {data.phase === "collecting" && data.lockAt && (
          <HardShadow radius={ui.rCard} offset={4} style={{ marginBottom: 14 }}>
            <View
              style={{
                backgroundColor: ui.brand,
                borderWidth: ui.border,
                borderColor: ui.ink,
                borderRadius: ui.rCard,
                paddingVertical: 12,
                paddingHorizontal: 14,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View>
                <Text
                  style={{
                    fontFamily: font.bold,
                    fontSize: 9,
                    letterSpacing: 1.4,
                    textTransform: "uppercase",
                    color: "#fff",
                  }}
                >
                  Locks in
                </Text>
                <Text
                  style={{
                    fontFamily: font.black,
                    fontSize: 26,
                    letterSpacing: -1,
                    color: "#fff",
                    marginTop: 2,
                  }}
                >
                  {formatCountdown(liveMsToLock)}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: font.bold,
                  fontSize: 10,
                  color: "#fff",
                  opacity: 0.92,
                  maxWidth: 120,
                  textAlign: "right",
                }}
              >
                best-supported time wins
              </Text>
            </View>
          </HardShadow>
        )}

        <Card>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
          >
            {whenLine ? <DateChip>{whenLine}</DateChip> : <View />}
            {headerSticker()}
          </View>
          <Text style={{ fontFamily: font.display, fontSize: 22, color: ui.ink, marginTop: 8 }}>
            {data.title}
          </Text>
          {data.location ? (
            <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 2 }}>
              {data.location}
            </Text>
          ) : null}
          {data.description ? (
            <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 6 }}>
              {data.description}
            </Text>
          ) : null}
        </Card>

        {data.phase === "collecting" && (
          <CollectingView
            data={data}
            picked={reactPicked}
            optedOut={optedOutLocal}
            saveState={saveState}
            busy={busy}
            onToggle={toggleReact}
            onToggleOptOut={toggleOptOut}
            onRetry={retrySave}
            onLock={lock}
            onAddCandidate={addCandidate}
          />
        )}

        {data.phase === "moment" && (
          <MomentView
            data={data}
            busy={busy}
            editing={editing}
            onEdit={() => setEditing(true)}
            statusLine={statusLine}
            onYes={() => answer("yes")}
            onNo={() => answer("no")}
            onConditional={() => {
              setCondPicked([]);
              setSheet(true);
            }}
          />
        )}

        {data.phase === "cleared" && <RevealView data={data} statusLine={statusLine} />}

        {data.phase === "fizzled" && (
          <View style={{ marginTop: 16 }}>
            <Card>
              <Text style={{ fontFamily: font.display, fontSize: 15, color: ui.ink }}>
                This one didn't come together
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
                Not enough people were free this time - no worries, no fuss. Float another whenever.
              </Text>
            </Card>
          </View>
        )}
      </ScrollView>

      <BottomSheet visible={sheet} onClose={() => setSheet(false)}>
        <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink }}>I'll go if...</Text>
        <Text
          style={{
            fontFamily: font.medium,
            fontSize: 10,
            color: ui.muted,
            marginTop: 2,
            marginBottom: 10,
          }}
        >
          ...these people are going
        </Text>
        <Toggle options={["At least one", "All of them"]} value={mode} onChange={setMode} />
        <View style={{ marginTop: 12, marginBottom: 4 }}>
          {data.members.map((m: Member) => {
            const on = condPicked.includes(m.id);
            return (
              <Pressable
                key={m.id}
                onPress={() =>
                  setCondPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))
                }
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 }}
              >
                <Avatar initial={m.name.charAt(0).toUpperCase()} color={ui.muted} size={26} />
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{m.name}</Text>
                <View style={{ marginLeft: "auto" }}>
                  <SelectCheck selected={on} />
                </View>
              </Pressable>
            );
          })}
          {data.members.length === 0 && (
            <Text style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted }}>
              No one else in this group.
            </Text>
          )}
        </View>
        <Button
          label="Confirm"
          variant="primary"
          disabled={!condPicked.length || busy}
          onPress={() => {
            setSheet(false);
            answer("conditional", {
              mode: mode === "All of them" ? "all" : "any",
              targetIds: condPicked,
            });
          }}
          style={{ marginTop: 12 }}
        />
      </BottomSheet>
    </ScreenBackground>
  );
}

// Collecting: tap which candidate times work, or opt out; the plan auto-locks at its deadline.
function CollectingView({
  data,
  picked,
  optedOut,
  saveState,
  busy,
  onToggle,
  onToggleOptOut,
  onRetry,
  onLock,
  onAddCandidate,
}: {
  data: Detail;
  picked: string[];
  optedOut: boolean;
  saveState: SaveState;
  busy: boolean;
  onToggle: (id: string) => void;
  onToggleOptOut: () => void;
  onRetry: () => void;
  onLock: (candidateId?: string) => void;
  onAddCandidate: (startsAt: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const newIso = isoFrom(newDate, newTime);

  // Shared table-row style; the first row overrides to no top divider.
  const row = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: ui.hairline,
  };

  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ fontFamily: font.display, fontSize: 14, color: ui.ink, marginBottom: 4 }}>
        Which of these work?
      </Text>
      <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginBottom: 10 }}>
        Tap the times you can make - private to you.
      </Text>
      <Card padding={0}>
        {data.candidates.map((c: Cand, i: number) => {
          const on = !optedOut && picked.includes(c.id);
          return (
            <Pressable
              key={c.id}
              onPress={() => onToggle(c.id)}
              style={{ ...row, borderTopWidth: i === 0 ? 0 : 1 }}
            >
              <SelectCheck selected={on} />
              <View>
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>
                  {formatSlot(c.startsAt)}
                </Text>
                {c.partOfDay ? (
                  <Text style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted }}>
                    {partOfDayLabel(c.partOfDay)}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}

        {!addOpen && (
          <Pressable onPress={() => setAddOpen(true)} style={row}>
            <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.brand }}>
              + Add a time
            </Text>
          </Pressable>
        )}

        {/* Opt-out: a distinct, tinted last row of the same table (mutually exclusive). */}
        <Pressable onPress={onToggleOptOut} style={{ ...row, backgroundColor: "#F1EEF6" }}>
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 5,
              borderWidth: 1.5,
              borderColor: ui.ink,
              backgroundColor: optedOut ? ui.ink : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {optedOut && <Text style={{ fontSize: 11, color: "#fff" }}>{"✓"}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>
              I can't make it
            </Text>
            <Text style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted }}>
              you won't be asked again - tap a time to rejoin
            </Text>
          </View>
        </Pressable>
      </Card>

      <SaveStatus state={saveState} onRetry={onRetry} />

      {addOpen && (
        <Card style={{ marginTop: 14 }}>
          <Text
            style={{
              fontFamily: font.bold,
              fontSize: 9,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: ui.ink,
              marginBottom: 10,
            }}
          >
            Add a time
          </Text>
          <DateTimePill
            dateValue={newDate}
            timeValue={newTime}
            onDate={setNewDate}
            onTime={setNewTime}
            minimumDate={new Date()}
          />
          <View
            style={{
              flexDirection: "row",
              gap: 16,
              marginTop: 14,
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <Pressable
              hitSlop={8}
              onPress={() => {
                setNewDate("");
                setNewTime("");
                setAddOpen(false);
              }}
            >
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.muted }}>Cancel</Text>
            </Pressable>
            <View style={{ width: 110 }}>
              <Button
                label="Add"
                variant="primary"
                disabled={busy || !newIso}
                onPress={() => {
                  if (!newIso) return;
                  onAddCandidate(newIso);
                  setNewDate("");
                  setNewTime("");
                  setAddOpen(false);
                }}
              />
            </View>
          </View>
        </Card>
      )}

      {/* No manual lock for members (pure deadline); this dev-only button forces it for demos. */}
      {__DEV__ && data.isCreator && (
        <View style={{ marginTop: 16 }}>
          <Button
            label="Force lock now (dev)"
            variant="outline"
            disabled={busy}
            onPress={() => onLock()}
          />
        </View>
      )}
    </View>
  );
}

// Tiny inline indicator for the auto-save: "Saving..." -> "Saved", or a tappable retry on failure.
function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "idle") return null;
  if (state === "error") {
    return (
      <Pressable onPress={onRetry} hitSlop={8} style={{ marginTop: 10 }}>
        <Text style={{ fontFamily: font.bold, fontSize: 11, color: ui.brand }}>
          Couldn't save - tap to retry
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
      {state === "saving" ? (
        <ActivityIndicator size="small" color={ui.muted} />
      ) : (
        <Text style={{ fontSize: 12, color: ui.going }}>{"✓"}</Text>
      )}
      <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted }}>
        {state === "saving" ? "Saving..." : "Saved - private to you"}
      </Text>
    </View>
  );
}

// Moment: a blind, timed commitment. We never show who else is in until the timer ends.
function MomentView({
  data,
  busy,
  editing,
  onEdit,
  statusLine,
  onYes,
  onNo,
  onConditional,
}: {
  data: Detail;
  busy: boolean;
  editing: boolean;
  onEdit: () => void;
  statusLine: string;
  onYes: () => void;
  onNo: () => void;
  onConditional: () => void;
}) {
  const showAnswer = editing || !data.myResponse;
  // A blind conditional reads as "awaiting" server-side (we cannot resolve it without leaking), so
  // give the committed-conditional case its own heading instead of the misleading "Awaiting...".
  const lockedHeading =
    data.myResponse?.kind === "conditional" ? "You're in if your people are" : statusLine;
  return (
    <View style={{ marginTop: 16 }}>
      {showAnswer ? (
        <>
          <Text style={{ fontFamily: font.display, fontSize: 14, color: ui.ink, marginBottom: 4 }}>
            Are you in?
          </Text>
          <Text
            style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginBottom: 10 }}
          >
            No one sees who's in until the timer ends. Answer honestly.
          </Text>
          <Button
            label={"✓  I'm in"}
            variant="affirmative"
            disabled={busy}
            onPress={onYes}
            style={{ marginBottom: 10 }}
          />
          <Button
            label="I'll go if..."
            variant="outline"
            disabled={busy}
            onPress={onConditional}
            style={{ marginBottom: 10 }}
          />
          <Button label="Can't make it" variant="outline" disabled={busy} onPress={onNo} />
        </>
      ) : (
        <>
          <Text style={{ fontFamily: font.bold, fontSize: 14, color: ui.ink, marginBottom: 12 }}>
            {lockedHeading}
          </Text>
          <Card>
            <Text
              style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted, lineHeight: 18 }}
            >
              Locked in. Who's in is revealed when the timer ends - hang tight.
            </Text>
          </Card>
          <Button
            label="Change my answer"
            variant="outline"
            disabled={busy}
            onPress={onEdit}
            style={{ marginTop: 12 }}
          />
        </>
      )}
    </View>
  );
}

// Reveal: the plan cleared - show the crowd who's in (only the IN crowd is ever listed).
function RevealView({ data, statusLine }: { data: Detail; statusLine: string }) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ fontFamily: font.bold, fontSize: 14, color: ui.ink, marginBottom: 12 }}>
        {statusLine}
      </Text>
      <Text
        style={{
          fontFamily: font.bold,
          fontSize: 9,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: ui.muted,
          marginBottom: 8,
        }}
      >
        Who's in
      </Text>
      <Card padding={0}>
        {data.going.map((p, i) => (
          <View
            key={p.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              padding: 11,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: ui.hairline,
            }}
          >
            <Avatar initial={p.name.charAt(0).toUpperCase()} color={p.color} size={26} />
            <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{p.name}</Text>
            <Text style={{ marginLeft: "auto", color: ui.going }}>{"✓"}</Text>
          </View>
        ))}
        {data.going.length === 0 && (
          <Text style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted, padding: 14 }}>
            No one's in.
          </Text>
        )}
      </Card>
    </View>
  );
}
