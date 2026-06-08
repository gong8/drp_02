import { useAuth, useUser } from "@clerk/clerk-expo";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { useDevAuth } from "../lib/auth";
import { ERR_SAVE, LABEL_DISPLAY_NAME, NAME_HINT, PLACEHOLDER_DISPLAY_NAME } from "../lib/copy";
import { trpc } from "../lib/trpc";
import { useFetchOnFocus } from "../lib/useFetchOnFocus";
import { ui } from "../theme";
import {
  AppText,
  Avatar,
  Button,
  Card,
  Field,
  FormError,
  ScreenHeader,
  ScreenScroll,
  TextButton,
} from "../ui";

// The Account screen. Reached from the top-right avatar on either tab, so it has a back button. Holds
// identity, an editable display name (so real names show in group rosters), and sign out.
export function Account() {
  const navigation = useNavigation();
  const { signOut } = useAuth();
  const { user } = useUser();
  const { devUser, signOutDev } = useDevAuth();

  const email = devUser
    ? "Signed in with the dev bypass"
    : (user?.emailAddresses?.[0]?.emailAddress ?? "");

  const [nameDraft, setNameDraft] = useState("");
  // The last-saved name, the baseline the Save button compares against (so it disappears after a save
  // in either auth mode).
  const [savedName, setSavedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // Seed the draft + baseline once from the SERVER display name - the same name rosters show - so an
  // edit round-trips for every identity (including the dev bypass, whose Clerk name is a fixed stub).
  // A ref guards the seed so a later refetch cannot clobber an in-progress edit.
  const seeded = useRef(false);

  useFetchOnFocus(
    useCallback(() => {
      trpc.users.me
        .query()
        .then((me) => {
          if (!seeded.current) {
            setNameDraft(me.name);
            setSavedName(me.name);
            seeded.current = true;
          }
        })
        .catch(() => {});
    }, []),
  );

  const trimmed = nameDraft.trim();
  const changed = trimmed !== "" && trimmed !== savedName;
  const shownName = nameDraft || savedName || "Account";

  async function save() {
    if (busy || !changed) return;
    setBusy(true);
    setSaveError(false);
    try {
      // Write the server (the roster source of truth) FIRST; only mirror to Clerk once it commits, so
      // a partial failure cannot leave the roster name and the header avatar silently diverged. The
      // dev user has no Clerk identity, so only the server write runs for it.
      await trpc.users.updateProfile.mutate({ name: trimmed });
      if (!devUser) await user?.update({ firstName: trimmed });
      setSavedName(trimmed);
    } catch {
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }

  const onSignOut = async () => {
    if (devUser) {
      signOutDev();
      return;
    }
    await signOut();
  };

  return (
    <ScreenScroll
      header={<ScreenHeader title="Account" onBack={() => navigation.goBack()} />}
      avoidKeyboard
    >
      {saveError && <FormError>{ERR_SAVE}</FormError>}
      <Card style={{ marginBottom: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar initial={shownName.charAt(0).toUpperCase()} color={ui.brand} size={44} />
          <View style={{ flex: 1 }}>
            <AppText variant="title">{shownName}</AppText>
            {email ? (
              <AppText variant="caption" style={{ marginTop: 2 }}>
                {email}
              </AppText>
            ) : null}
          </View>
        </View>
      </Card>

      <Field
        label={LABEL_DISPLAY_NAME}
        value={nameDraft}
        onChangeText={setNameDraft}
        placeholder={PLACEHOLDER_DISPLAY_NAME}
        right={changed ? <TextButton label="Save" disabled={busy} onPress={save} /> : undefined}
      />
      <AppText variant="caption" style={{ marginTop: 8, lineHeight: 16 }}>
        {NAME_HINT}
      </AppText>

      <Button label="Sign out" variant="outline" onPress={onSignOut} style={{ marginTop: 20 }} />
    </ScreenScroll>
  );
}
