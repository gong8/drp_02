import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import type { GroupsStackParams } from "../../App";
import {
  ACTION_BACK_TO_GROUPS,
  ACTION_FIND_GROUP,
  ACTION_JOIN_GROUP,
  ACTION_JOINING,
  ACTION_NOT_NOW,
  ACTION_TRY_AGAIN,
  ERR_NETWORK,
  JOIN_NOT_FOUND_BODY,
  JOIN_NOT_FOUND_TITLE,
  JOIN_PROMPT_SUB,
  JOIN_PROMPT_TITLE,
  joinPrompt,
  LABEL_JOIN_CODE,
  memberCountLabel,
  TITLE_JOIN,
} from "../lib/copy";
import { colorFor, initials } from "../lib/format";
import { CODE_LENGTH, normalizeCode } from "../lib/invite";
import type { RouterOutputs } from "../lib/trpc";
import { trpc } from "../lib/trpc";
import { trpcErrorCode } from "../lib/trpcError";
import { useFetchOnFocus } from "../lib/useFetchOnFocus";
import {
  AppText,
  Avatar,
  Button,
  Card,
  Field,
  ScreenHeader,
  ScreenLoading,
  ScreenScroll,
  Section,
} from "../ui";

type Preview = RouterOutputs["groups"]["previewByCode"];
type Props = NativeStackScreenProps<GroupsStackParams, "JoinGroup">;
type Phase = "idle" | "checking" | "confirm" | "joining" | "error";

// The single join funnel: the landing for a tapped invite link, the GroupsList paste sheet, and the
// post-sign-in resume. It previews the group a code resolves to, the user confirms, then joins.
export function JoinGroup({ route, navigation }: Props) {
  const initial = normalizeCode(route.params?.code ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [codeDraft, setCodeDraft] = useState(initial);
  const [preview, setPreview] = useState<Preview | null>(null);
  // "notFound" = the code resolved to no group (a known, specific outcome); "network" = any other
  // failure. The value name matches the branch it drives below.
  const [errReason, setErrReason] = useState<"notFound" | "network">("notFound");
  const autoRan = useRef(false);

  const code = normalizeCode(codeDraft);
  const back = () =>
    navigation.canGoBack() ? navigation.goBack() : navigation.navigate("GroupsList");

  const lookUp = useCallback(async (raw: string) => {
    const c = normalizeCode(raw);
    if (c.length !== CODE_LENGTH) {
      setPhase("idle");
      return;
    }
    setPhase("checking");
    try {
      setPreview(await trpc.groups.previewByCode.query({ code: c }));
      setPhase("confirm");
    } catch (e) {
      setErrReason(trpcErrorCode(e) === "NOT_FOUND" ? "notFound" : "network");
      setPhase("error");
    }
  }, []);

  // A code arriving via a tapped link auto-resolves to the confirm step (once).
  useFetchOnFocus(
    useCallback(() => {
      if (!autoRan.current && initial.length === CODE_LENGTH) {
        autoRan.current = true;
        lookUp(initial);
      }
    }, [initial, lookUp]),
  );

  async function join() {
    if (phase === "joining") return;
    setPhase("joining");
    try {
      const res = await trpc.groups.joinByCode.mutate({ code });
      // reset (not navigate) so back from the new group lands on the list, not this spent flow. The
      // welcome band only fires for a genuinely new join, never for an already-a-member redirect.
      navigation.reset({
        index: 1,
        routes: [
          { name: "GroupsList" },
          { name: "GroupDetail", params: { groupId: res.groupId, justJoined: !res.alreadyMember } },
        ],
      });
    } catch (e) {
      setErrReason(trpcErrorCode(e) === "NOT_FOUND" ? "notFound" : "network");
      setPhase("error");
    }
  }

  const header = <ScreenHeader title={TITLE_JOIN} onBack={back} />;

  if (phase === "checking") return <ScreenLoading />;

  if (phase === "error") {
    const notFound = errReason === "notFound";
    return (
      <ScreenScroll header={header}>
        <Card>
          <AppText variant="title">{notFound ? JOIN_NOT_FOUND_TITLE : ERR_NETWORK}</AppText>
          {notFound ? (
            <AppText variant="captionPara" style={{ marginTop: 6 }}>
              {JOIN_NOT_FOUND_BODY}
            </AppText>
          ) : null}
          <Button
            label={notFound ? ACTION_BACK_TO_GROUPS : ACTION_TRY_AGAIN}
            variant={notFound ? "primary" : "outline"}
            onPress={notFound ? () => navigation.navigate("GroupsList") : () => lookUp(code)}
            style={{ marginTop: 14 }}
          />
        </Card>
      </ScreenScroll>
    );
  }

  if ((phase === "confirm" || phase === "joining") && preview) {
    return (
      <ScreenScroll header={header}>
        <Section title={joinPrompt(preview.name)} size="lg" />
        <Card style={{ marginBottom: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
            <Avatar initial={initials(preview.name)} color={colorFor(preview.groupId)} size={44} />
            <View>
              <AppText variant="title">{preview.name}</AppText>
              <AppText variant="caption" style={{ marginTop: 1 }}>
                {memberCountLabel(preview.memberCount)}
              </AppText>
            </View>
          </View>
        </Card>
        <Button
          label={phase === "joining" ? ACTION_JOINING : ACTION_JOIN_GROUP}
          variant="affirmative"
          disabled={phase === "joining"}
          onPress={join}
        />
        <Button label={ACTION_NOT_NOW} variant="ghost" onPress={back} style={{ marginTop: 8 }} />
      </ScreenScroll>
    );
  }

  // idle: no/partial code - the manual entry path.
  return (
    <ScreenScroll header={header} avoidKeyboard>
      <Section title={JOIN_PROMPT_TITLE} size="lg" sub={JOIN_PROMPT_SUB} />
      <Field
        label={LABEL_JOIN_CODE}
        value={codeDraft}
        onChangeText={(t) => setCodeDraft(normalizeCode(t))}
        placeholder="ABCDEF12"
      />
      <Button
        label={ACTION_FIND_GROUP}
        variant="primary"
        disabled={code.length !== CODE_LENGTH}
        onPress={() => lookUp(code)}
        style={{ marginTop: 18 }}
      />
    </ScreenScroll>
  );
}
