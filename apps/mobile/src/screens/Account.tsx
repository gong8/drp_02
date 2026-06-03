import { useAuth, useUser } from "@clerk/clerk-expo";
import { ScrollView, Text, View } from "react-native";
import { useDevAuth, useDisplayName } from "../lib/auth";
import { font, ui } from "../theme";
import { Avatar, Button, Card, Heading, ScreenBackground } from "../ui";

// The Account tab. Holds identity + sign out (Clerk session or the dev bypass), replacing the
// old header AccountButton now that native headers are hidden.
export function Account() {
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
    <ScreenBackground header={<Heading title="Account" />}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Card style={{ marginBottom: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Avatar initial={name.charAt(0).toUpperCase()} color={ui.brand} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink }}>{name}</Text>
              {email ? (
                <Text
                  style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 2 }}
                >
                  {email}
                </Text>
              ) : null}
            </View>
          </View>
        </Card>
        <Button label="Sign out" variant="outline" onPress={onSignOut} />
      </ScrollView>
    </ScreenBackground>
  );
}
