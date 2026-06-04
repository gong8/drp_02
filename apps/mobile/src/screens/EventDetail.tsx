import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import {
  clock12,
  dayUpper,
  formatCountdown,
  formatSlot,
  isoFrom,
  partOfDayLabel,
} from "../lib/format";
import { addCandidateHorizon } from "../lib/lock";
import { trpc } from "../lib/trpc";
import { useBusyAction } from "../lib/useBusyAction";
import { TICK_MS, useLiveClock } from "../lib/useLiveClock";
import { font, ui } from "../theme";
import {
  Avatar,
  BackBar,
  BottomSheet,
  Button,
  Card,
  DateTimePill,
  DetailError,
  PersonRow,
  ScreenBackground,
  ScreenLoading,
  SelectCheck,
  StickerTag,
  Toggle,
} from "../ui";

type Detail = NonNullable<Awaited<ReturnType<typeof trpc.events.get.query>>>;
type Member = Detail["members"][number];
type Candidate = Detail["candidates"][number];
type CondModeLabel = "At least one" | "All of them";
type SaveState = "idle" | "saving" | "saved" | "error";
type Props = NativeStackScreenProps<MeetupsStackParams, "EventDetail">;

export function EventDetail({ route, navigation }: Props) {
  const { eventId } = route.params;
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  // moment conditional sheet
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [condModeLabel, setCondModeLabel] = useState<CondModeLabel>("At least one");
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

  // Busy-guarded mutate-then-reload runner shared by lock/addCandidate/answer/changeAnswer.
  const runAction = useBusyAction({ busy, setBusy, setError, load });

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

  // The 1s ticker only drives the live moment countdown, so only run it during the moment.
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
        if (active && phaseRef.current !== "cleared" && phaseRef.current !== "fizzled") load();
      }, 5000);
      return () => {
        active = false;
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

  function lock(candidateId?: string) {
    return runAction(() =>
      trpc.events.lock.mutate(
        candidateId ? { eventId, candidateId, momentMinutes: 60 } : { eventId, momentMinutes: 60 },
      ),
    );
  }

  // Anyone in the group can float a new time into the menu while collecting; refetch so it shows.
  function addCandidate(startsAt: string) {
    if (!data) return;
    return runAction(() => trpc.events.addCandidate.mutate({ eventId, startsAt }));
  }

  function answer(
    kind: "yes" | "no" | "conditional",
    cond?: { mode: "all" | "any"; targetIds: string[] },
  ) {
    return runAction(async () => {
      await trpc.events.respond.mutate(cond ? { eventId, kind, cond } : { eventId, kind });
      setEditing(false);
    });
  }

  // "Change my answer" un-commits: it clears the response so the plan returns to Action Required
  // until a new answer is given, then reopens the choices.
  function changeAnswer() {
    return runAction(async () => {
      await trpc.events.unrespond.mutate({ eventId });
      setEditing(true);
    });
  }

  if (loading) return <ScreenLoading />;
  if (error || !data)
    return (
      <DetailError
        error={error}
        onBack={() => navigation.goBack()}
        notFoundLabel="Plan not found."
      />
    );

  const liveMsLeft = data.momentEndsAt ? new Date(data.momentEndsAt).getTime() - now : 0;
  const liveMsToLock = data.lockAt ? new Date(data.lockAt).getTime() - now : 0;
  // The chosen time, shown as a hero banner once a slot is locked (moment/cleared); collecting has
  // no single time yet.
  const heroIso = data.chosenStartsAt && data.phase !== "collecting" ? data.chosenStartsAt : null;
  const heroClock = heroIso ? clock12(heroIso) : null;

  function headerSticker() {
    // Only the cleared phase gets a sticker; collecting + moment use the full-bleed countdown banner.
    if (data?.phase === "cleared") return <StickerTag label="It's on" />;
    return null;
  }

  let statusLine: string;
  switch (data.myStatus) {
    case "going":
      statusLine = "You're in";
      break;
    case "declined":
      statusLine = "You can't make it";
      break;
    default:
      statusLine = "Awaiting your answer";
  }

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
          <CountdownBanner label="Locks in" ms={liveMsToLock} note="best-supported time wins" />
        )}
        {data.phase === "moment" && (
          <CountdownBanner label="Closes in" ms={liveMsLeft} note="who's in reveals then" />
        )}

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
                <Text
                  style={{ fontFamily: font.mono, fontSize: 12, letterSpacing: 1, color: ui.muted }}
                >
                  {dayUpper(heroIso)}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 3 }}>
                  <Text
                    style={{ fontFamily: font.mono, fontSize: 34, lineHeight: 36, color: ui.ink }}
                  >
                    {heroClock.time}
                  </Text>
                  <Text
                    style={{
                      fontFamily: font.mono,
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
              {headerSticker()}
            </View>
          ) : null}
          <View style={{ paddingHorizontal: 16, paddingTop: heroIso ? 14 : 16, paddingBottom: 16 }}>
            <Text
              style={{ fontFamily: font.display, fontSize: 24, letterSpacing: -0.5, color: ui.ink }}
            >
              {data.title}
            </Text>
            {data.location ? (
              <Text
                style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted, marginTop: 4 }}
              >
                at <Text style={{ fontFamily: font.bold, color: ui.ink }}>{data.location}</Text>
              </Text>
            ) : null}
            {data.description ? (
              <Text
                style={{
                  fontFamily: font.medium,
                  fontSize: 12,
                  color: ui.muted,
                  marginTop: 8,
                  lineHeight: 18,
                }}
              >
                {data.description}
              </Text>
            ) : null}
          </View>
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
            onEdit={changeAnswer}
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
        <Toggle
          options={["At least one", "All of them"]}
          value={condModeLabel}
          onChange={setCondModeLabel}
        />
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
              mode: condModeLabel === "All of them" ? "all" : "any",
              targetIds: condPicked,
            });
          }}
          style={{ marginTop: 12 }}
        />
      </BottomSheet>
    </ScreenBackground>
  );
}

// A full-bleed countdown bar for the time-pressured phases (the collecting deadline and the moment
// reveal). Stretches edge-to-edge with top/bottom ink rules - visually distinct from rounded cards.
function CountdownBanner({ label, ms, note }: { label: string; ms: number; note: string }) {
  return (
    <View
      style={{
        marginHorizontal: -16,
        marginTop: -2,
        marginBottom: 14,
        backgroundColor: ui.brand,
        borderColor: ui.ink,
        borderTopWidth: ui.border,
        borderBottomWidth: ui.border,
        paddingVertical: 14,
        paddingHorizontal: 16,
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
          {label}
        </Text>
        <Text
          style={{
            fontFamily: font.black,
            fontSize: 28,
            letterSpacing: -1,
            color: "#fff",
            marginTop: 2,
          }}
        >
          {formatCountdown(ms)}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: font.bold,
          fontSize: 10,
          color: "#fff",
          opacity: 0.92,
          maxWidth: 130,
          textAlign: "right",
        }}
      >
        {note}
      </Text>
    </View>
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

  const candidateTimes = data.candidates.map((c: Candidate) => new Date(c.startsAt).getTime());
  const lockMs = data.lockAt ? new Date(data.lockAt).getTime() : Date.now();
  const addMinDate = new Date(Math.max(Date.now(), lockMs));
  const addMaxDate = new Date(
    addCandidateHorizon(
      Math.min(...candidateTimes),
      Math.max(...candidateTimes),
      data.whenMode === "fuzzy",
    ),
  );

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
        {data.candidates.map((c: Candidate, i: number) => {
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
          <SelectCheck selected={optedOut} accent={ui.ink} />
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
            minimumDate={addMinDate}
            maximumDate={addMaxDate}
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
          <PersonRow
            key={p.id}
            name={p.name}
            color={p.color}
            index={i}
            right={<Text style={{ marginLeft: "auto", color: ui.going }}>{"✓"}</Text>}
          />
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
