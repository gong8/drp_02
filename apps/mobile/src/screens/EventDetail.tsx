import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { countdown, formatDate, formatTime } from "../lib/format";
import { trpc } from "../lib/trpc";
import { font, ui } from "../theme";
import { Avatar, BackBar, BottomSheet, Button, Card, DateChip, ScreenBackground, SelectCheck, StickerTag, Toggle } from "../ui";

type Detail = NonNullable<Awaited<ReturnType<typeof trpc.events.get.query>>>;
type Member = Detail["members"][number];
type Mode = "At least one" | "All of them";
type Props = NativeStackScreenProps<MeetupsStackParams, "EventDetail">;

export function EventDetail({ route, navigation }: Props) {
  const { eventId } = route.params;
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [mode, setMode] = useState<Mode>("At least one");
  const [picked, setPicked] = useState<string[]>([]);

  const load = useCallback(() => {
    return trpc.events.get
      .query({ id: eventId })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [eventId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function answer(kind: "yes" | "no" | "conditional", cond?: { mode: "all" | "any"; targetIds: string[] }) {
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
          <Text style={{ fontFamily: font.medium, color: ui.muted }}>{error ? "Couldn't reach the server." : "Event not found."}</Text>
        </View>
      </ScreenBackground>
    );
  }

  const showRespond = editing || (!data.myResponse && !data.resolved);
  const statusLine = data.myStatus === "going" ? "You're going" : data.myStatus === "declined" ? "You can't make it" : "Awaiting your response";

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        <BackBar title={data.groupName} onBack={() => navigation.goBack()} />

        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <DateChip>{formatDate(data.startsAt)}</DateChip>
            {!data.resolved && <StickerTag label={countdown(data.respondByAt)} />}
          </View>
          <Text style={{ fontFamily: font.display, fontSize: 22, color: ui.ink, marginTop: 8 }}>{data.title}</Text>
          <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 2 }}>
            {data.location} {"·"} {formatTime(data.startsAt)}
          </Text>
          {data.description ? <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 6 }}>{data.description}</Text> : null}
        </Card>

        {showRespond ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontFamily: font.display, fontSize: 14, color: ui.ink, marginBottom: 10 }}>Are you in?</Text>
            <Button label={"✓  I'm in"} variant="affirmative" disabled={busy} onPress={() => answer("yes")} style={{ marginBottom: 10 }} />
            <Button label="I'll go if..." variant="outline" disabled={busy} onPress={() => { setPicked([]); setSheet(true); }} style={{ marginBottom: 10 }} />
            <Button label="Can't make it" variant="outline" disabled={busy} onPress={() => answer("no")} />
          </View>
        ) : (
          <View style={{ marginTop: 16 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontFamily: font.bold, fontSize: 14, color: ui.ink }}>{statusLine}</Text>
              {!data.resolved && (
                <Pressable onPress={() => setEditing(true)}>
                  <Text style={{ fontFamily: font.bold, fontSize: 12, color: ui.brand }}>Change</Text>
                </Pressable>
              )}
            </View>
            <Text style={{ fontFamily: font.bold, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: ui.muted, marginBottom: 8 }}>Who's going</Text>
            <Card padding={0}>
              {data.going.map((p, i) => (
                <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: ui.hairline }}>
                  <Avatar initial={p.name.charAt(0).toUpperCase()} color={p.color} size={26} />
                  <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{p.name}</Text>
                  <Text style={{ marginLeft: "auto", color: ui.going }}>{"✓"}</Text>
                </View>
              ))}
              {data.going.length === 0 && <Text style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted, padding: 14 }}>No one's confirmed yet.</Text>}
            </Card>
          </View>
        )}
      </ScrollView>

      <BottomSheet visible={sheet} onClose={() => setSheet(false)}>
        <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink }}>I'll go if...</Text>
        <Text style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted, marginTop: 2, marginBottom: 10 }}>...these people are going</Text>
        <Toggle options={["At least one", "All of them"]} value={mode} onChange={setMode} />
        <View style={{ marginTop: 12, marginBottom: 4 }}>
          {data.members.map((m: Member) => {
            const on = picked.includes(m.id);
            return (
              <Pressable
                key={m.id}
                onPress={() => setPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))}
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
          {data.members.length === 0 && <Text style={{ fontFamily: font.medium, fontSize: 12, color: ui.muted }}>No one else in this group.</Text>}
        </View>
        <Button
          label="Confirm"
          variant="primary"
          disabled={!picked.length || busy}
          onPress={() => {
            setSheet(false);
            answer("conditional", { mode: mode === "All of them" ? "all" : "any", targetIds: picked });
          }}
          style={{ marginTop: 12 }}
        />
      </BottomSheet>
    </ScreenBackground>
  );
}
