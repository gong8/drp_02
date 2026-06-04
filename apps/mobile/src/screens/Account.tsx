import { useAuth, useUser } from "@clerk/clerk-expo";
import { useNavigation } from "@react-navigation/native";
import { Text, View } from "react-native";
import { useDevAuth, useDisplayName } from "../lib/auth";
import { font, ui } from "../theme";
import { AppText, Avatar, Button, Card, ScreenHeader, ScreenScroll } from "../ui";

// The Account screen. Reached from the top-right avatar on either tab, so it has a back button. Holds
// identity + sign out (Clerk session or the dev bypass).
export function Account() {
  const navigation = useNavigation();
  const { signOut } = useAuth();
  const { user } = useUser();
  const { devUser, signOutDev } = useDevAuth();

  const name = useDisplayName("Account");
  const email = devUser
    ? "Signed in with the dev bypass"
    : (user?.emailAddresses?.[0]?.emailAddress ?? "");

  const onSignOut = async () => {
    if (devUser) {
      signOutDev();
      return;
    }
    await signOut();
  };

  return (
    <ScreenScroll header={<ScreenHeader title="Account" onBack={() => navigation.goBack()} />}>
      <Card style={{ marginBottom: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar initial={name.charAt(0).toUpperCase()} color={ui.brand} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink }}>{name}</Text>
            {email ? (
              <AppText variant="caption" style={{ marginTop: 2 }}>
                {email}
              </AppText>
            ) : null}
          </View>
        </View>
      </Card>
      <Button label="Sign out" variant="outline" onPress={onSignOut} />
    </ScreenScroll>
  );
}
