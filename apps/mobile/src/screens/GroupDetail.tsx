import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { GroupsStackParams } from "../../App";
import {
  ACTION_COPIED,
  ACTION_COPY,
  ACTION_LINK_COPIED,
  ACTION_SHARE_INVITE,
  ACTION_TRY_AGAIN,
  ERR_NETWORK,
  INVITE_CODE_PENDING,
  INVITE_HINT,
  inviteShareText,
  LABEL_GROUP_NAME,
  LABEL_INVITE_LINK,
  LABEL_JOIN_CODE,
  TITLE_INVITE,
  welcomeToGroup,
} from "../lib/copy";
import { formatCode, joinUrl } from "../lib/invite";
import { copyToClipboard, shareInvite } from "../lib/share";
import type { RouterOutputs } from "../lib/trpc";
import { trpc } from "../lib/trpc";
import { useBusyAction } from "../lib/useBusyAction";
import { useFetchOnFocus } from "../lib/useFetchOnFocus";
import { ui } from "../theme";
import {
  AppText,
  Band,
  BottomSheet,
  Button,
  Card,
  DetailError,
  EmptyState,
  Field,
  FieldLabel,
  PersonRow,
  ScreenHeader,
  ScreenLoading,
  ScreenScroll,
  Section,
  TextButton,
} from "../ui";

type Detail = NonNullable<RouterOutputs["groups"]["get"]>;
type Invite = RouterOutputs["groups"]["inviteByGroup"];
type Props = NativeStackScreenProps<GroupsStackParams, "GroupDetail">;

export function GroupDetail({ route, navigation }: Props) {
  const { groupId } = route.params;
  const [data, setData] = useState<Detail | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // The invite fetch failed (vs still loading); drives an error+retry surface in the sheet.
  const [inviteError, setInviteError] = useState(false);
  // Which invite control most recently confirmed a copy (label swaps to "Copied" for ~1.5s).
  const [copied, setCopied] = useState<null | "code" | "link" | "share">(null);
  // A one-time welcome band after joining via an invite.
  const [welcome, setWelcome] = useState(false);
  // Whether the name field has been seeded from the server yet. We seed only on the first successful
  // load so a later reload (e.g. after renaming) cannot clobber an in-progress rename draft.
  const seededName = useRef(false);
  const handledCreate = useRef(false);
  const handledJoin = useRef(false);

  const load = useCallback(() => {
    return trpc.groups.get
      .query({ id: groupId })
      .then((d) => {
        setData(d);
        if (d && !seededName.current) {
          setNameDraft(d.name);
          seededName.current = true;
        }
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [groupId]);

  useFetchOnFocus(load);

  // Fetch the group's invite (member-gated; the viewer is a member, so it resolves). Shared by the
  // open effect and the retry button.
  const loadInvite = useCallback(() => {
    setInviteError(false);
    trpc.groups.inviteByGroup
      .query({ groupId })
      .then((inv) => setInvite(inv))
      .catch(() => setInviteError(true));
  }, [groupId]);

  // Lazily fetch the invite the first time the sheet opens. Kept off the focus load so opening a group
  // never pays for an invite query.
  useEffect(() => {
    if (inviteOpen && !invite) loadInvite();
  }, [inviteOpen, invite, loadInvite]);

  // Land-on-invite after creating the group: open the sheet once the group has loaded, then clear the
  // flag so a refocus does not reopen it.
  useEffect(() => {
    if (!handledCreate.current && route.params?.justCreated && data) {
      handledCreate.current = true;
      setInviteOpen(true);
      navigation.setParams({ justCreated: undefined });
    }
  }, [route.params?.justCreated, data, navigation]);

  // One-time welcome band after joining via an invite.
  useEffect(() => {
    if (!handledJoin.current && route.params?.justJoined && data) {
      handledJoin.current = true;
      setWelcome(true);
      navigation.setParams({ justJoined: undefined });
    }
  }, [route.params?.justJoined, data, navigation]);

  const runAction = useBusyAction({ busy, setBusy, setError, load });

  function flash(which: "code" | "link" | "share") {
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  }

  // Prefer the server-built link (canonical, from PUBLIC_WEB_URL); fall back to one built client-side.
  const inviteLink = invite ? (invite.url ?? joinUrl(invite.code)) : null;

  async function copyCode() {
    if (!invite) return;
    await copyToClipboard(invite.code);
    flash("code");
  }
  async function copyLink() {
    if (!inviteLink) return;
    await copyToClipboard(inviteLink);
    flash("link");
  }
  async function share() {
    if (!inviteLink || !data) return;
    const { copied: didCopy } = await shareInvite(inviteShareText(data.name), inviteLink);
    if (didCopy) flash("share");
  }

  if (loading) return <ScreenLoading />;
  if (error || !data)
    return (
      <DetailError
        error={error}
        onBack={() => navigation.goBack()}
        notFoundLabel="Group not found."
      />
    );

  const renamed = nameDraft.trim() !== "" && nameDraft.trim() !== data.name;

  return (
    <ScreenScroll header={<ScreenHeader title={data.name} onBack={() => navigation.goBack()} />}>
      {welcome ? (
        <Band style={{ marginBottom: 16 }}>
          <AppText variant="title" style={{ color: ui.onInk }}>
            {welcomeToGroup(data.name)}
          </AppText>
        </Band>
      ) : null}

      <Field
        label={LABEL_GROUP_NAME}
        value={nameDraft}
        onChangeText={setNameDraft}
        right={
          renamed ? (
            <TextButton
              label="Save"
              disabled={busy}
              onPress={() =>
                runAction(() => trpc.groups.rename.mutate({ id: groupId, name: nameDraft.trim() }))
              }
            />
          ) : undefined
        }
      />

      <FieldLabel style={{ marginTop: 16, marginBottom: 6 }}>
        {`Members (${data.members.length})`}
      </FieldLabel>
      <Card padding={0}>
        {data.members.map((m, i) => (
          <PersonRow
            key={m.id}
            name={m.name}
            color={m.color}
            index={i}
            avatarSize={28}
            right={
              <View style={{ marginLeft: "auto" }}>
                <TextButton
                  label="×"
                  tone="muted"
                  disabled={busy}
                  onPress={() =>
                    runAction(() => trpc.groups.removeMember.mutate({ groupId, userId: m.id }))
                  }
                />
              </View>
            }
          />
        ))}
      </Card>

      <Button
        label={TITLE_INVITE}
        variant="primary"
        onPress={() => setInviteOpen(true)}
        style={{ marginTop: 16 }}
      />

      <BottomSheet visible={inviteOpen} onClose={() => setInviteOpen(false)}>
        <Section title={TITLE_INVITE} size="lg" sub={INVITE_HINT} />
        {invite ? (
          <>
            <Card tone={ui.tint}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <FieldLabel tone="muted">{LABEL_JOIN_CODE}</FieldLabel>
                <View style={{ marginLeft: "auto" }}>
                  <TextButton
                    label={copied === "code" ? ACTION_COPIED : ACTION_COPY}
                    onPress={copyCode}
                  />
                </View>
              </View>
              <AppText
                variant="screenTitle"
                mono
                style={{ fontSize: 34, letterSpacing: 4, marginTop: 4 }}
              >
                {formatCode(invite.code)}
              </AppText>
            </Card>

            <Field
              label={LABEL_INVITE_LINK}
              value={inviteLink ?? ""}
              editable={false}
              right={
                <TextButton
                  label={copied === "link" ? ACTION_COPIED : ACTION_COPY}
                  onPress={copyLink}
                />
              }
              style={{ marginTop: 14 }}
            />

            <Button
              label={copied === "share" ? ACTION_LINK_COPIED : ACTION_SHARE_INVITE}
              variant="primary"
              onPress={share}
              style={{ marginTop: 16 }}
            />
          </>
        ) : inviteError ? (
          <Card>
            <AppText variant="caption">{ERR_NETWORK}</AppText>
            <View style={{ marginTop: 8, alignItems: "flex-start" }}>
              <TextButton label={ACTION_TRY_AGAIN} onPress={loadInvite} />
            </View>
          </Card>
        ) : (
          <EmptyState inCard>{INVITE_CODE_PENDING}</EmptyState>
        )}
      </BottomSheet>
    </ScreenScroll>
  );
}
