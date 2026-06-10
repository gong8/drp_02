import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { MeetupsStackParams } from "../../App";
import { devAuthEnabled } from "../lib/clerk";
import {
  ACTION_COPY_LINK,
  ACTION_JOINING_MEETUP,
  ACTION_LINK_COPIED,
  ACTION_OPEN_IN_BROWSER,
  ACTION_TRY_AGAIN,
  ACTION_VIEW_MEETUP,
  ERR_NETWORK,
  joinAndRespond,
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
function useMeetupPreview(token: string) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errReason, setErrReason] = useState<"notFound" | "network">("notFound");

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
  const { phase, setPhase, preview, errReason, setErrReason, reload } = useMeetupPreview(token);

  async function join() {
    if (phase === "joining") return;
    setPhase("joining");
    try {
      const res = await trpc.events.joinByToken.mutate({ eventId: token });
      // reset (not navigate) so back from the meetup lands on the dashboard, not this spent funnel.
      navigation.reset({
        index: 1,
        routes: [{ name: "Dashboard" }, { name: "EventDetail", params: { eventId: res.eventId } }],
      });
    } catch (e) {
      setErrReason(trpcErrorCode(e) === "NOT_FOUND" ? "notFound" : "network");
      setPhase("error");
    }
  }

  if (phase === "checking") return <ScreenLoading />;

  const header = <ScreenHeader title="" onBack={() => navigation.navigate("Dashboard")} />;

  if (phase === "error" || !preview) {
    const notFound = errReason === "notFound";
    return (
      <ScreenScroll header={header}>
        <Card>
          <AppText variant="title">{notFound ? MEETUP_NOT_FOUND_TITLE : ERR_NETWORK}</AppText>
          {notFound ? (
            <AppText variant="captionPara" style={{ marginTop: 6 }}>
              {MEETUP_NOT_FOUND_BODY}
            </AppText>
          ) : null}
          <Button
            label={notFound ? ACTION_VIEW_MEETUP : ACTION_TRY_AGAIN}
            variant={notFound ? "primary" : "outline"}
            onPress={notFound ? () => navigation.navigate("Dashboard") : reload}
            style={{ marginTop: 14 }}
          />
        </Card>
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
export function MeetupWelcome({ token }: { token: string }) {
  const { phase, preview, reload } = useMeetupPreview(token);
  const { onGoogle, signInDev, busy } = useSignInActions();
  // In a hostile in-app browser, Google sign-in is blocked - surface the open-in-browser escape hatch.
  const inApp = detectInAppBrowser();

  // Stash the token before sign-in so it survives the web OAuth page reload, then start the flow.
  const start = (signIn: () => void) => {
    setPendingMeetup(token);
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
        {inApp.hostile ? <InAppBrowserNotice token={token} /> : null}
        <Button
          label={busy ? "Connecting..." : joinAndRespond(preview?.groupName ?? "the group")}
          variant="affirmative"
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
