import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { devAuthEnabled } from "../lib/clerk";
import {
  ACTION_COPY_LINK,
  ACTION_JOINING_MEETUP,
  ACTION_LINK_COPIED,
  ACTION_OPEN_IF_IN,
  ACTION_OPEN_IN_BROWSER,
  ACTION_SIGN_IN_ANYWAY,
  ACTION_TRY_AGAIN,
  ACTION_VIEW_MEETUP,
  ERR_NETWORK,
  joinAndRespond,
  MEETUP_CLOSED_BODY,
  MEETUP_CLOSED_TITLE,
  MEETUP_CLOSED_WELCOME,
  MEETUP_NO_APP,
  MEETUP_NOT_FOUND_BODY,
  MEETUP_NOT_FOUND_TITLE,
  MEETUP_OPEN_IN_BROWSER_BODY,
  MEETUP_OPEN_IN_BROWSER_TITLE,
  MEETUP_PREVIEW_PICK_TIME,
  meetupInviteHeadline,
} from "../lib/copy";
import { colorFor, formatSlot, initials } from "../lib/format";
import { meetupUrl, setPendingMeetup } from "../lib/meetup";
import { copyToClipboard } from "../lib/share";
import type { RouterOutputs } from "../lib/trpc";
import { trpc } from "../lib/trpc";
import { trpcErrorCode } from "../lib/trpcError";
import { useSignInActions } from "../lib/useSignInActions";
import { detectInAppBrowser } from "../lib/webview";
import {
  AppText,
  Avatar,
  Button,
  Card,
  ScreenBackground,
  ScreenHeader,
  ScreenLoading,
  ScreenScroll,
  Section,
} from "../ui";

type Preview = RouterOutputs["events"]["previewByToken"];
type Phase = "checking" | "preview" | "joining" | "error";

// Shared preview fetch for both the public (logged-out) landing and the authed screen. previewByToken
// is a PUBLIC procedure, so this works with no session. Fetches once on mount; `reload` re-runs it.
// "closed" never comes from the preview itself - it is the join-time FORBIDDEN when the +1 door shut
// between the preview and the tap (DRP-63).
function useMeetupPreview(token: string) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errReason, setErrReason] = useState<"notFound" | "network" | "closed">("notFound");

  const load = useCallback(async () => {
    setPhase("checking");
    try {
      setPreview(await trpc.events.previewByToken.query({ eventId: token }));
      setPhase("preview");
    } catch (e) {
      setErrReason(trpcErrorCode(e) === "NOT_FOUND" ? "notFound" : "network");
      setPhase("error");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return { phase, setPhase, preview, errReason, setErrReason, reload: load };
}

// The when-line under the headline: the chosen time once a moment/cleared plan has one, else (while
// collecting) an invitation to help pick. Keeps the preview meaningful in every phase.
function whenLine(preview: Preview): string {
  if (preview.phase === "collecting") return MEETUP_PREVIEW_PICK_TIME;
  return formatSlot(preview.startsAt);
}

// The shared preview card: the meetup headline + the group it's with + the when-line. No member or
// voter identity (the preview payload carries none) - just what you were invited to.
function MeetupCard({ preview }: { preview: Preview }) {
  return (
    <Card style={{ marginBottom: 20 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
        <Avatar
          initial={initials(preview.groupName)}
          color={colorFor(preview.groupName)}
          size={44}
        />
        <View style={{ flex: 1 }}>
          <AppText variant="title">{preview.groupName}</AppText>
          <AppText variant="caption" style={{ marginTop: 1 }}>
            {whenLine(preview)}
          </AppText>
        </View>
      </View>
    </Card>
  );
}

// The authed entry: an already-signed-in user tapped a meetup link (routed here by the linking
// config). Preview, then one tap joins the meetup's group (idempotent) and lands on the plan.
type Props = NativeStackScreenProps<MeetupsStackParams, "JoinMeetup">;
export function JoinMeetup({ route, navigation }: Props) {
  const token = route.params?.token ?? "";
  // The sharer ref off the link's query (?via=), for brought-by attribution (DRP-63).
  const via = route.params?.via;
  const { phase, setPhase, preview, errReason, setErrReason, reload } = useMeetupPreview(token);

  async function join() {
    if (phase === "joining") return;
    setPhase("joining");
    try {
      const res = await trpc.events.joinByToken.mutate({ eventId: token, via });
      // reset (not navigate) so back from the meetup lands on the dashboard, not this spent funnel.
      navigation.reset({
        index: 1,
        routes: [{ name: "Dashboard" }, { name: "EventDetail", params: { eventId: res.eventId } }],
      });
    } catch (e) {
      const code = trpcErrorCode(e);
      setErrReason(code === "NOT_FOUND" ? "notFound" : code === "FORBIDDEN" ? "closed" : "network");
      setPhase("error");
    }
  }

  if (phase === "checking") return <ScreenLoading />;

  const header = <ScreenHeader title="" onBack={() => navigation.navigate("Dashboard")} />;

  if (phase === "error" || !preview) {
    const terminal = errReason !== "network";
    const title =
      errReason === "notFound"
        ? MEETUP_NOT_FOUND_TITLE
        : errReason === "closed"
          ? MEETUP_CLOSED_TITLE
          : ERR_NETWORK;
    const body =
      errReason === "notFound"
        ? MEETUP_NOT_FOUND_BODY
        : errReason === "closed"
          ? MEETUP_CLOSED_BODY
          : null;
    return (
      <ScreenScroll header={header}>
        <Card>
          <AppText variant="title">{title}</AppText>
          {body ? (
            <AppText variant="captionPara" style={{ marginTop: 6 }}>
              {body}
            </AppText>
          ) : null}
          <Button
            label={terminal ? ACTION_VIEW_MEETUP : ACTION_TRY_AGAIN}
            variant={terminal ? "primary" : "outline"}
            onPress={terminal ? () => navigation.navigate("Dashboard") : reload}
            style={{ marginTop: 14 }}
          />
        </Card>
      </ScreenScroll>
    );
  }

  // A closed door (DRP-63): say so up front, but keep a quiet way in for people already in the
  // roster - the join no-ops them straight to the plan and never admits a new +1 (server-enforced).
  if (!preview.joinsOpen) {
    return (
      <ScreenScroll header={header}>
        <Section title={meetupInviteHeadline(preview.activity)} size="lg" />
        <MeetupCard preview={preview} />
        <Card style={{ marginBottom: 16 }}>
          <AppText variant="title">{MEETUP_CLOSED_TITLE}</AppText>
          <AppText variant="captionPara" style={{ marginTop: 6 }}>
            {MEETUP_CLOSED_BODY}
          </AppText>
        </Card>
        <Button
          label={phase === "joining" ? ACTION_JOINING_MEETUP : ACTION_OPEN_IF_IN}
          variant="outline"
          disabled={phase === "joining"}
          onPress={join}
        />
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll header={header}>
      <Section title={meetupInviteHeadline(preview.activity)} size="lg" />
      <MeetupCard preview={preview} />
      <Button
        label={phase === "joining" ? ACTION_JOINING_MEETUP : ACTION_VIEW_MEETUP}
        variant="affirmative"
        disabled={phase === "joining"}
        onPress={join}
      />
    </ScreenScroll>
  );
}

// Shown when the link opened inside a hostile in-app browser (WhatsApp/Instagram/etc.), where Google
// sign-in is blocked. Offers an escape hatch: open in the real browser (best-effort) or copy the link
// to paste there. Never a dead end - copy always works even when window.open is swallowed.
function InAppBrowserNotice({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = meetupUrl(token);
  const openExternal = () => {
    if (typeof window !== "undefined") window.open(url, "_blank");
  };
  const copy = async () => {
    await copyToClipboard(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Card style={{ marginBottom: 16 }}>
      <AppText variant="title">{MEETUP_OPEN_IN_BROWSER_TITLE}</AppText>
      <AppText variant="captionPara" style={{ marginTop: 6 }}>
        {MEETUP_OPEN_IN_BROWSER_BODY}
      </AppText>
      <Button
        label={ACTION_OPEN_IN_BROWSER}
        variant="primary"
        onPress={openExternal}
        style={{ marginTop: 12 }}
      />
      <Button
        label={copied ? ACTION_LINK_COPIED : ACTION_COPY_LINK}
        variant="outline"
        onPress={copy}
        style={{ marginTop: 8 }}
      />
    </Card>
  );
}

// The public (logged-out) landing rendered by the auth Gate when a /m/<token> link is opened while
// signed out. Shows the meetup BEFORE sign-in (value first), then one CTA starts Google sign-in;
// the token is stashed first so the post-redirect resume joins + lands on the plan. The dev-bypass
// button mirrors SignIn so the demo can sidestep real OAuth.
export function MeetupWelcome({ token, via = null }: { token: string; via?: string | null }) {
  const { phase, preview, reload } = useMeetupPreview(token);
  const { onGoogle, signInDev, busy } = useSignInActions();
  // In a hostile in-app browser, Google sign-in is blocked - surface the open-in-browser escape hatch.
  const inApp = detectInAppBrowser();
  // A closed +1 door (DRP-63): the preview still shows, sign-in still works (an existing roster
  // member resumes straight to the plan), but the CTA stops promising a join a stranger won't get.
  const closed = preview ? !preview.joinsOpen : false;

  // Stash the link (token + sharer ref) before sign-in so it survives the web OAuth page reload,
  // then start the flow.
  const start = (signIn: () => void) => {
    setPendingMeetup(token, via);
    signIn();
  };

  if (phase === "checking") return <ScreenLoading />;

  const headline = preview ? meetupInviteHeadline(preview.activity) : MEETUP_NOT_FOUND_TITLE;

  return (
    <ScreenBackground>
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 8 }}>
        <Section title={headline} size="lg" />
        {preview ? (
          <MeetupCard preview={preview} />
        ) : (
          <Card style={{ marginBottom: 20 }}>
            <AppText variant="captionPara">{ERR_NETWORK}</AppText>
            <Button
              label={ACTION_TRY_AGAIN}
              variant="outline"
              onPress={reload}
              style={{ marginTop: 14 }}
            />
          </Card>
        )}
        {closed ? (
          <Card style={{ marginBottom: 16 }}>
            <AppText variant="title">{MEETUP_CLOSED_TITLE}</AppText>
            <AppText variant="captionPara" style={{ marginTop: 6 }}>
              {MEETUP_CLOSED_WELCOME}
            </AppText>
          </Card>
        ) : null}
        {inApp.hostile ? <InAppBrowserNotice token={token} /> : null}
        <Button
          label={
            busy
              ? "Connecting..."
              : closed
                ? ACTION_SIGN_IN_ANYWAY
                : joinAndRespond(preview?.groupName ?? "the group")
          }
          variant={closed ? "outline" : "affirmative"}
          disabled={busy}
          onPress={() => start(onGoogle)}
        />
        {devAuthEnabled ? (
          <Button
            label="Continue as test user"
            variant="outline"
            disabled={busy}
            onPress={() => start(signInDev)}
            style={{ marginTop: 8 }}
          />
        ) : null}
        <AppText variant="caption" style={{ textAlign: "center", marginTop: 6 }}>
          {MEETUP_NO_APP}
        </AppText>
      </View>
    </ScreenBackground>
  );
}
